import { Duration, Effect, Either } from "effect";
import { InsufficientFunds, PaymentFailed } from "../domain/errors";
import type { MintRejected, MintUnreachable } from "../domain/errors";
import { Amount, NonNegativeAmount, UnixSeconds } from "../domain/primitives";
import type { MintUrl } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { inspectOperationWith } from "../internal/operations";
import { pollUntil } from "../internal/poll";
import {
  checkMintQuote,
  claimMintQuote,
  QUOTE_UNPAID,
} from "../internal/quoteClaim";
import type { ClaimedQuote, QuoteClaimContext } from "../internal/quoteClaim";
import { decodeMintQuote, emitQuoteState } from "../internal/quotes";
import type { DecodedMintQuote } from "../internal/quotes";
import { selectSpendableProofs } from "../internal/spend";
import { nowSeconds } from "../internal/time";
import { sat } from "../internal/units";
import { Melt } from "../melt/Melt";
import { MeltDraft } from "../melt/domain";
import type { MeltError } from "../melt/domain";
import { inputFeeAllowance } from "../mint/internal/keysetFees";
import {
  boundKeysetId,
  classifyMintError,
  WalletInstances,
} from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { KeyValueStore } from "../ports/KeyValueStore";
import { OperationStore } from "../ports/OperationStore";
import { ProofStore } from "../ports/ProofStore";
import { AutoswapClaimResult, AutoswapReceipt } from "./domain";
import type { AutoswapDraft, AutoswapError } from "./domain";
import { autoswapRecords } from "./internal/autoswapRecords";
import type { PendingAutoswapClaim } from "./internal/autoswapRecords";

/**
 * Attempts at sizing the swap. Every failed one only costs an unpaid mint
 * quote: the melt prices itself before it touches a proof.
 */
const MAX_AMOUNT_ATTEMPTS = 4;
/** The melt settled, so the target's quote flips within a poll or two. */
const CLAIM_POLL_ATTEMPTS = 6;
const CLAIM_POLL_INTERVAL = Duration.millis(500);

/** Melt failures wearing autoswap's error union. */
const asAutoswapError = (error: MeltError): AutoswapError =>
  error._tag === "QuoteExpired"
    ? new PaymentFailed({
        mint: error.mint,
        quoteId: error.quoteId,
        detail: "the source mint's melt quote expired before it was paid",
      })
    : error;

/**
 * Consolidating a foreign mint's balance into the main mint: quote a topup at
 * the target, melt the source balance against that invoice (stepping the
 * amount down on shortage), persist the claim before touching proofs, then
 * mint at the target. Pending claims survive crashes and are drained by
 * `resumePendingClaims`, which mints deterministically off the persisted
 * counter slots so an interrupted claim never mints twice. When to trigger a
 * swap (thresholds, debounce, opt-in) stays caller policy.
 */
export class Autoswap extends Effect.Service<Autoswap>()("linkshu/Autoswap", {
  dependencies: [WalletInstances.Default, Melt.Default],
  effect: Effect.gen(function* () {
    const kv = yield* KeyValueStore;
    const proofStore = yield* ProofStore;
    const operationStore = yield* OperationStore;
    const instances = yield* WalletInstances;
    const melt = yield* Melt;
    const inspector = yield* Inspector.orNoop;
    const records = autoswapRecords({ kv, operationStore, inspector });

    const claimContext = (
      wallet: LoadedWallet,
    ): QuoteClaimContext<PendingAutoswapClaim> => ({
      kv,
      inspector,
      proofStore,
      wallet,
      reason: "autoswap",
      records,
    });

    const createTargetQuote = (
      wallet: LoadedWallet,
      mint: MintUrl,
      amount: number,
    ): Effect.Effect<DecodedMintQuote, MintUnreachable | MintRejected> =>
      Effect.flatMap(
        Effect.tryPromise({
          try: () => wallet.createMintQuoteBolt11(amount),
          catch: (error) => classifyMintError(mint, error),
        }),
        (raw) => decodeMintQuote(mint, raw),
      );

    /**
     * The melt settled at the source, so the target mint sees the payment
     * within a poll or two. Until it does the record stays: `resumePending`
     * claims it later rather than this call minting against an unpaid quote.
     */
    const awaitClaimable = (
      wallet: LoadedWallet,
      pending: PendingAutoswapClaim,
    ): Effect.Effect<ClaimedQuote, AutoswapError> =>
      Effect.gen(function* () {
        let lastState: string | null = null;
        const pollState = Effect.map(
          checkMintQuote(wallet, pending),
          (quote) => {
            if (quote.state !== lastState) {
              lastState = quote.state;
              emitQuoteState(inspector, "autoswap", pending, quote.state);
            }
            return quote.state;
          },
        );
        const state = yield* pollUntil(pollState, {
          attempts: CLAIM_POLL_ATTEMPTS,
          interval: CLAIM_POLL_INTERVAL,
          settled: (state) => state !== QUOTE_UNPAID,
        });
        if (state === QUOTE_UNPAID) {
          return yield* new PaymentFailed({
            mint: pending.mint,
            quoteId: pending.quoteId,
            detail:
              "the melt settled but the target mint still reports its quote unpaid; the pending claim resumes it",
          });
        }
        return yield* claimMintQuote(claimContext(wallet), pending);
      });

    /**
     * One sized attempt: quote at the target, record the claim, melt at the
     * source, mint at the target. `InsufficientFunds` (the left) is the only
     * outcome that may retire the record — the melt prices itself before it
     * touches a proof, so nothing was paid. Every other failure leaves the
     * record behind, because the invoice may have settled.
     */
    const swapAmount = (
      draft: AutoswapDraft,
      target: LoadedWallet,
      keysetId: PendingAutoswapClaim["keysetId"],
      amount: number,
    ): Effect.Effect<
      Either.Either<AutoswapReceipt, InsufficientFunds>,
      AutoswapError
    > =>
      Effect.gen(function* () {
        const quote = yield* createTargetQuote(
          target,
          draft.targetMint,
          amount,
        );
        // The record lands before the melt can pay the invoice.
        const record = yield* records.create({
          quoteId: quote.quoteId,
          mint: draft.targetMint,
          unit: sat,
          keysetId,
          amount: Amount.make(amount),
          invoice: quote.invoice,
          sourceMint: draft.sourceMint,
          expiresAt: quote.expiresAt,
          createdAt: UnixSeconds.make(yield* nowSeconds),
          counter: null,
        });
        emitQuoteState(inspector, "autoswap", record, quote.state);

        const paid = yield* Effect.either(
          melt.melt(
            new MeltDraft({ mint: draft.sourceMint, invoice: quote.invoice }),
          ),
        );
        if (Either.isLeft(paid)) {
          if (paid.left._tag !== "InsufficientFunds") {
            return yield* Effect.fail(asAutoswapError(paid.left));
          }
          yield* records.settle(record, "failed");
          return Either.left(paid.left);
        }

        const claimed = yield* awaitClaimable(target, record);
        return Either.right(
          new AutoswapReceipt({
            sourceMint: draft.sourceMint,
            targetMint: draft.targetMint,
            movedAmount: claimed.amount,
            feePaid: paid.right.feePaid,
            operationId: claimed.operationId,
          }),
        );
      });

    const claim = (
      draft: AutoswapDraft,
    ): Effect.Effect<AutoswapReceipt, AutoswapError> =>
      Effect.gen(function* () {
        const source = yield* instances.get(draft.sourceMint, sat);
        const target = yield* instances.get(draft.targetMint, sat);
        const keysetId = yield* boundKeysetId(draft.targetMint, target);
        const { spendable, available } = yield* selectSpendableProofs({
          proofStore,
          inspector,
          wallet: source,
          mint: draft.sourceMint,
          unit: sat,
          reason: "autoswap",
        });
        // Upper bound on what the melt's own swap pays the source mint in
        // cashu input fees; the Lightning fee reserve is learned per attempt.
        const inputFee = inputFeeAllowance(source, spendable.length);

        let amount = available - inputFee;
        let shortfall: InsufficientFunds | null = null;
        for (let attempt = 0; attempt < MAX_AMOUNT_ATTEMPTS; attempt += 1) {
          if (amount <= 0) break;
          const outcome = yield* swapAmount(draft, target, keysetId, amount);
          if (Either.isRight(outcome)) return outcome.right;
          shortfall = outcome.left;
          // The shortage prices this attempt's Lightning fee reserve
          // (`required - amount`); the next attempt gives that up along with
          // the input-fee margin. `amount - 1` only guards a mint reporting a
          // shortage the arithmetic cannot see, so the loop always shrinks.
          amount = Math.min(
            outcome.left.available -
              (outcome.left.required - amount) -
              inputFee,
            amount - 1,
          );
        }
        return yield* shortfall ??
          new InsufficientFunds({
            mint: draft.sourceMint,
            required: Amount.make(Math.max(inputFee, 1)),
            available: NonNegativeAmount.make(available),
          });
      }).pipe(
        inspectOperationWith(
          inspector,
          "autoswap.claim",
          { sourceMint: draft.sourceMint, targetMint: draft.targetMint },
          (receipt) => receipt,
        ),
      );

    const resultOf = (
      pending: PendingAutoswapClaim,
      status: "claimed" | "not-claimable-yet" | "dropped",
      claimed: ClaimedQuote | null,
    ): AutoswapClaimResult =>
      new AutoswapClaimResult({
        quoteId: pending.quoteId,
        targetMint: pending.mint,
        status,
        operationId: pending.id,
        amount: claimed?.amount ?? null,
      });

    const dropClaim = (
      pending: PendingAutoswapClaim,
    ): Effect.Effect<AutoswapClaimResult> =>
      Effect.as(
        records.settle(pending, "failed"),
        resultOf(pending, "dropped", null),
      );

    /**
     * A record the mint's own answer says is not progressing — a confirmed
     * UNPAID, or a rejected claim: kept until its deadline (the melt may
     * still be settling, the rejection may be a transient 4xx) and retired
     * after a day of the mint answering the same way.
     */
    const expireOrKeep = (
      pending: PendingAutoswapClaim,
    ): Effect.Effect<AutoswapClaimResult> =>
      Effect.flatMap(nowSeconds, (now) =>
        now > records.deadlineOf(pending)
          ? dropClaim(pending)
          : Effect.succeed(resultOf(pending, "not-claimable-yet", null)),
      );

    /**
     * One persisted claim. Only the mint's own answer, held past the
     * deadline, may retire it: a confirmed UNPAID (the melt never happened)
     * or a rejected claim (its deterministic recovery is exhausted). A mint
     * that will not load or answer says nothing about funds possibly
     * waiting at the target, so the record is kept — a local clock alone
     * must never prune a quote that was paid right before a crash.
     */
    const resumeOne = (
      pending: PendingAutoswapClaim,
    ): Effect.Effect<AutoswapClaimResult> =>
      Effect.gen(function* () {
        const wallet = yield* instances.get(pending.mint, pending.unit);
        const state = (yield* checkMintQuote(wallet, pending)).state;
        emitQuoteState(inspector, "autoswap", pending, state);
        if (state === QUOTE_UNPAID) return yield* expireOrKeep(pending);
        return yield* claimMintQuote(claimContext(wallet), pending).pipe(
          Effect.map((claimed) => resultOf(pending, "claimed", claimed)),
          Effect.catchAll((error) =>
            error._tag === "MintRejected"
              ? expireOrKeep(pending)
              : Effect.succeed(resultOf(pending, "not-claimable-yet", null)),
          ),
        );
      }).pipe(
        Effect.catchAll(() =>
          Effect.succeed(resultOf(pending, "not-claimable-yet", null)),
        ),
      );

    const resumePendingClaims: Effect.Effect<
      ReadonlyArray<AutoswapClaimResult>
    > = Effect.gen(function* () {
      const results: AutoswapClaimResult[] = [];
      for (const pending of yield* records.readAll) {
        results.push(yield* resumeOne(pending));
      }
      return results;
    }).pipe(
      inspectOperationWith(
        inspector,
        "autoswap.resumePendingClaims",
        {},
        (results) => results,
      ),
    );

    return { claim, resumePendingClaims } as const;
  }),
}) {}
