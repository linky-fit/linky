import type {
  MeltProofsResponse,
  MeltQuoteBolt11Response,
  Proof as CashuProof,
} from "@cashu/cashu-ts";
import { Duration, Effect, Either, Schema } from "effect";
import {
  InsufficientFunds,
  MintRejected,
  MintUnreachable,
  PaymentFailed,
  PaymentPending,
  QuoteExpired,
} from "../domain/errors";
import { Amount, NonNegativeAmount, UnixSeconds } from "../domain/primitives";
import type { MintUrl, QuoteId } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { cashuAmountToNumber } from "../internal/cashuAmounts";
import { recoverFromCollision } from "../internal/collisionRecovery";
import {
  advanceCounterTo,
  readCounter,
  withCounterLock,
} from "../internal/counters";
import type { CounterScope } from "../internal/counters";
import { inspectOperationWith } from "../internal/operations";
import { isRecoverableOutputCollision } from "../internal/outputCollisions";
import {
  domainToNewProofs,
  insertProofs,
  setProofState,
  storedSecrets,
  toDomainProof,
  toNewProofs,
  totalAmount,
} from "../internal/proofs";
import { checkProofStates, unspentProofs } from "../internal/proofStates";
import { pollUntil } from "../internal/poll";
import { decodeQuoteId, emitQuoteState } from "../internal/quotes";
import {
  selectSpendableProofs,
  settleSwap,
  swapProofsForAmount,
} from "../internal/spend";
import { nowSeconds } from "../internal/time";
import { sat } from "../internal/units";
import {
  boundKeysetId,
  classifyMintError,
  WalletInstances,
} from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { KeyValueStore } from "../ports/KeyValueStore";
import { OperationStore } from "../ports/OperationStore";
import { ProofStore } from "../ports/ProofStore";
import type { StoredProof } from "../ports/ProofStore";
import type { Proof } from "../token/domain";
import { toDomainProofs } from "../token/internal/cashuProofs";
import { MeltQuote, MeltReceipt, MeltResumeResult } from "./domain";
import type { MeltDraft, MeltError } from "./domain";
import { blankOutputCount } from "./internal/blankOutputs";
import { meltRecords } from "./internal/meltRecords";
import type { PendingMelt } from "./internal/meltRecords";

const MAX_MELT_ATTEMPTS = 5;
/**
 * Blind advance past a collision the NUT-09 probe cannot locate: orphaned
 * *unsigned* blanks at the mint (NUT 11004) never restore, so the jump must
 * clear a whole run of them, not just this melt's own blank range.
 */
const MELT_COLLISION_FALLBACK_BUMP = 64;
/** Bounded wait for a PENDING Lightning payment before handing off to resume. */
const PENDING_POLL_ATTEMPTS = 6;
const PENDING_POLL_INTERVAL = Duration.millis(500);

const decodeAmount = Schema.decodeUnknownOption(Amount);
const decodeReserve = Schema.decodeUnknownOption(NonNegativeAmount);
const decodeExpiry = Schema.decodeUnknownOption(UnixSeconds);
const decodeQuoteState = Schema.decodeUnknownOption(
  Schema.Literal("UNPAID", "PENDING", "PAID"),
);

type QuoteState = "UNPAID" | "PENDING" | "PAID" | null;

/** Serialized onto a melt record the mint rejected. */
const encodeMeltError = Schema.encodeSync(
  Schema.parseJson(Schema.Union(MintRejected, MintUnreachable)),
);

const toMeltQuote = (
  mint: MintUrl,
  raw: MeltQuoteBolt11Response,
): Effect.Effect<MeltQuote, MintRejected> => {
  const quoteId = decodeQuoteId(raw.quote);
  const amount = decodeAmount(cashuAmountToNumber(raw.amount));
  const feeReserve = decodeReserve(cashuAmountToNumber(raw.fee_reserve));
  if (
    quoteId._tag === "None" ||
    amount._tag === "None" ||
    feeReserve._tag === "None"
  ) {
    return Effect.fail(
      new MintRejected({
        mint,
        code: null,
        detail: "mint returned a malformed melt quote",
      }),
    );
  }
  const expiry = decodeExpiry(raw.expiry);
  return Effect.succeed(
    new MeltQuote({
      quoteId: quoteId.value,
      mint,
      amount: amount.value,
      feeReserve: feeReserve.value,
      expiresAt: expiry._tag === "Some" ? expiry.value : null,
    }),
  );
};

/** Runtime-validated quote state; anything unrecognized reads as unknown. */
const quoteStateOf = (raw: MeltQuoteBolt11Response): QuoteState => {
  const decoded = decodeQuoteState(
    typeof raw.state === "string" ? raw.state.trim().toUpperCase() : raw.state,
  );
  return decoded._tag === "Some" ? decoded.value : null;
};

const counterScopeOf = (pending: PendingMelt): CounterScope => ({
  mint: pending.mint,
  unit: pending.unit,
  keysetId: pending.keysetId,
});

const paymentPendingOf = (pending: PendingMelt): PaymentPending =>
  new PaymentPending({
    mint: pending.mint,
    quoteId: pending.quoteId,
    operationId: pending.id,
    amount: pending.amount,
  });

/** Everything the post-swap melt steps need to settle one payment. */
interface MeltExecution {
  readonly wallet: LoadedWallet;
  readonly raw: MeltQuoteBolt11Response;
  readonly inputs: ReadonlyArray<CashuProof>;
  readonly pending: PendingMelt;
}

/**
 * Paying a bolt11 invoice from the wallet: quote, swap `amount + feeReserve`
 * out (fee-inclusive), melt, and account NUT-08 blank outputs by advancing
 * the deterministic counter past the full blank range — not just the change
 * actually returned — so orphaned blind signatures at the mint can never
 * collide with later derivations. Change and any post-swap remainder are
 * persisted as `available` proofs before the receipt resolves; a failure
 * after the swap loses no funds. A melt the mint has not settled leaves a
 * `melt` operation `held` over its inputs, and `resumePending` finishes it.
 */
export class Melt extends Effect.Service<Melt>()("linkshu/Melt", {
  dependencies: [WalletInstances.Default],
  effect: Effect.gen(function* () {
    const kv = yield* KeyValueStore;
    const proofStore = yield* ProofStore;
    const operationStore = yield* OperationStore;
    const instances = yield* WalletInstances;
    const inspector = yield* Inspector.orNoop;
    const ctx = { proofStore, inspector };
    const records = meltRecords({ kv, operationStore, inspector });

    const createQuoteAt = (
      wallet: LoadedWallet,
      draft: MeltDraft,
    ): Effect.Effect<
      { raw: MeltQuoteBolt11Response; quote: MeltQuote },
      MintUnreachable | MintRejected
    > =>
      Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: () => wallet.createMeltQuoteBolt11(draft.invoice),
          catch: (error) => classifyMintError(draft.mint, error),
        });
        const quote = yield* toMeltQuote(draft.mint, raw);
        emitQuoteState(inspector, "melt", quote, raw.state);
        return { raw, quote };
      });

    const checkQuote = (
      wallet: LoadedWallet,
      quote: { readonly quoteId: QuoteId; readonly mint: MintUrl },
    ): Effect.Effect<MeltQuoteBolt11Response, MintUnreachable | MintRejected> =>
      Effect.tryPromise({
        try: () => wallet.checkMeltQuoteBolt11(quote.quoteId),
        catch: (error) => classifyMintError(quote.mint, error),
      });

    const heldInputs = (
      pending: PendingMelt,
    ): Effect.Effect<ReadonlyArray<StoredProof>> =>
      Effect.map(proofStore.loadAll, (proofs) =>
        proofs.filter(
          (proof) => proof.operationId === pending.id && proof.state === "held",
        ),
      );

    /**
     * The mint never executed (or reversed) the melt: the inputs return to
     * balance and the record is closed.
     */
    const releaseInputs = (
      pending: PendingMelt,
      status: "unpaid" | "failed",
      reason: string,
      error?: string,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* setProofState(
          ctx,
          yield* heldInputs(pending),
          "available",
          reason,
          null,
        );
        yield* records.settle(pending, status, error);
      });

    /**
     * Re-derives the melt's blank range via NUT-09 when the change proofs did
     * not arrive with the response (deferred change, lost response, resume).
     * Only proofs the mint explicitly reports unspent and that the inventory
     * does not hold count, so a crash between persisting change and closing
     * the record cannot import it twice.
     */
    const reclaimBlankChange = (
      wallet: LoadedWallet,
      pending: PendingMelt,
    ): Effect.Effect<ReadonlyArray<Proof>, MintUnreachable | MintRejected> =>
      Effect.gen(function* () {
        const blanks = blankOutputCount(pending.inputsTotal - pending.amount);
        const blankStart = pending.counter;
        if (blankStart === null || blanks === 0) return [];
        const restored = yield* Effect.tryPromise({
          try: () =>
            wallet.restore(blankStart, blanks, { keysetId: pending.keysetId }),
          catch: (error) => classifyMintError(pending.mint, error),
        });
        const proofs = toDomainProofs(restored.proofs);
        if (proofs === null) {
          return yield* new MintRejected({
            mint: pending.mint,
            code: null,
            detail: "mint returned malformed proofs from the change reclaim",
          });
        }
        const known = storedSecrets(yield* proofStore.loadAll);
        const unstored = proofs.filter((proof) => !known.has(proof.secret));
        const states = yield* checkProofStates(wallet, pending.mint, unstored);
        return unspentProofs(unstored, states);
      });

    /**
     * The payment settled: NUT-08 change becomes `available` before the held
     * inputs are marked `spent` and the record closes, so the funds are never
     * outside the store; the actual fee is what the inputs lost beyond
     * invoice + change.
     */
    const finishPaid = (
      pending: PendingMelt,
      change: ReadonlyArray<Proof>,
    ): Effect.Effect<MeltReceipt, MintRejected> =>
      Effect.gen(function* () {
        const changeAmount = totalAmount(change);
        const feePaid = pending.inputsTotal - pending.amount - changeAmount;
        if (feePaid < 0) {
          return yield* new MintRejected({
            mint: pending.mint,
            code: null,
            detail: "mint returned more change than the melt inputs held",
          });
        }
        yield* insertProofs(
          ctx,
          domainToNewProofs(
            change,
            pending.mint,
            pending.unit,
            "available",
            null,
          ),
          "melt-change",
        );
        yield* setProofState(
          ctx,
          yield* heldInputs(pending),
          "spent",
          "melt-paid",
        );
        yield* records.settle(pending, "paid");
        return new MeltReceipt({
          mint: pending.mint,
          quoteId: pending.quoteId,
          paidAmount: pending.amount,
          feeReserve: pending.feeReserve,
          feePaid: NonNegativeAmount.make(feePaid),
          changeAmount: NonNegativeAmount.make(changeAmount),
        });
      });

    /**
     * The one decision every post-request path shares: PAID finishes the
     * melt (change via NUT-09), UNPAID hands the inputs back, and anything
     * else leaves the inputs `held` under the record for `resumePending`.
     */
    const settleQuoteState = (
      wallet: LoadedWallet,
      pending: PendingMelt,
      state: QuoteState,
    ): Effect.Effect<MeltReceipt, MeltError> =>
      Effect.gen(function* () {
        if (state === "PAID") {
          const change = yield* reclaimBlankChange(wallet, pending);
          return yield* finishPaid(pending, change);
        }
        if (state === "UNPAID") {
          yield* releaseInputs(pending, "unpaid", "melt-unpaid");
          return yield* new PaymentFailed({
            mint: pending.mint,
            quoteId: pending.quoteId,
            detail: "the lightning payment failed at the mint",
          });
        }
        return yield* Effect.fail(paymentPendingOf(pending));
      });

    /** Bounded wait on a PENDING payment; the record outlives the wait. */
    const awaitPendingSettlement = (
      exec: MeltExecution,
    ): Effect.Effect<MeltReceipt, MeltError> =>
      Effect.gen(function* () {
        let lastState: QuoteState = "PENDING";
        // A missed poll is no information; the bounded poll decides.
        const pollState = Effect.map(
          Effect.either(checkQuote(exec.wallet, exec.pending)),
          Either.match({
            onLeft: (): QuoteState => null,
            onRight: (checked) => {
              const state = quoteStateOf(checked);
              if (state !== null && state !== lastState) {
                lastState = state;
                emitQuoteState(inspector, "melt", exec.pending, state);
              }
              return state;
            },
          }),
        );
        yield* Effect.sleep(PENDING_POLL_INTERVAL);
        const state = yield* pollUntil(pollState, {
          attempts: PENDING_POLL_ATTEMPTS,
          interval: PENDING_POLL_INTERVAL,
          settled: (state) => state === "PAID" || state === "UNPAID",
        });
        return yield* settleQuoteState(exec.wallet, exec.pending, state);
      });

    const settleMeltResponse = (
      exec: MeltExecution,
      response: MeltProofsResponse<MeltQuoteBolt11Response>,
    ): Effect.Effect<MeltReceipt, MeltError> =>
      Effect.gen(function* () {
        const state = quoteStateOf(response.quote);
        if (state !== null)
          emitQuoteState(inspector, "melt", exec.pending, state);
        if (state === "PAID") {
          const change = Array.isArray(response.change)
            ? toDomainProofs(response.change)
            : null;
          return yield* finishPaid(
            exec.pending,
            change ??
              // Malformed inline change never drops funds: the blank range
              // is deterministic, so the signed change restores from seed.
              (yield* reclaimBlankChange(exec.wallet, exec.pending)),
          );
        }
        if (state === "UNPAID") {
          return yield* settleQuoteState(exec.wallet, exec.pending, state);
        }
        return yield* awaitPendingSettlement(exec);
      });

    /**
     * The melt response was lost in transit; the payment may have happened.
     * The quote is asked once: a settled answer decides, no answer leaves
     * the inputs `held` under the record.
     */
    const resolveLostMeltResponse = (
      exec: MeltExecution,
    ): Effect.Effect<MeltReceipt, MeltError> =>
      Effect.gen(function* () {
        const checked = yield* Effect.either(
          checkQuote(exec.wallet, exec.pending),
        );
        const state = Either.isRight(checked)
          ? quoteStateOf(checked.right)
          : null;
        if (state !== null)
          emitQuoteState(inspector, "melt", exec.pending, state);
        return yield* settleQuoteState(exec.wallet, exec.pending, state);
      });

    /**
     * Melts under the counter lock. Each attempt persists its blank slot in
     * the record and burns the full blank range before reaching the mint:
     * the mint keeps every blank it saw — signed or not — so later
     * derivations must never revisit those slots, and a restore after the
     * melt reproduces exactly this accounting.
     */
    const executeMelt = (
      started: MeltExecution,
    ): Effect.Effect<MeltReceipt, MeltError> => {
      const scope = counterScopeOf(started.pending);
      return withCounterLock(
        kv,
        scope,
      )(
        Effect.gen(function* () {
          let exec = started;
          const blanks = blankOutputCount(
            exec.pending.inputsTotal - exec.pending.amount,
          );
          let lastCollision: unknown = null;
          for (let attempt = 0; attempt < MAX_MELT_ATTEMPTS; attempt += 1) {
            const counter = yield* readCounter(kv, scope);
            exec = {
              ...exec,
              pending: yield* records.withCounter(exec.pending, counter),
            };
            yield* advanceCounterTo(
              kv,
              inspector,
              scope,
              counter + blanks,
              "used",
            );
            const outcome = yield* Effect.either(
              Effect.tryPromise({
                try: () =>
                  exec.wallet.meltProofsBolt11(
                    exec.raw,
                    [...exec.inputs],
                    undefined,
                    { type: "deterministic", counter },
                  ),
                catch: (error): unknown => error,
              }),
            );
            if (Either.isRight(outcome)) {
              return yield* settleMeltResponse(exec, outcome.right);
            }
            const raw = outcome.left;
            if (isRecoverableOutputCollision(raw)) {
              lastCollision = raw;
              yield* recoverFromCollision(
                {
                  kv,
                  inspector,
                  wallet: exec.wallet,
                  scope,
                  fallbackBump: MELT_COLLISION_FALLBACK_BUMP,
                },
                counter,
                raw,
              );
              continue;
            }
            const failure = classifyMintError(scope.mint, raw);
            if (failure._tag === "MintUnreachable") {
              return yield* resolveLostMeltResponse(exec);
            }
            // A definitive rejection means the mint never executed the melt.
            yield* releaseInputs(
              exec.pending,
              "failed",
              "melt-rejected",
              encodeMeltError(failure),
            );
            return yield* Effect.fail(failure);
          }
          const failure = classifyMintError(scope.mint, lastCollision);
          yield* releaseInputs(
            exec.pending,
            "failed",
            "melt-rejected",
            encodeMeltError(failure),
          );
          return yield* Effect.fail(failure);
        }),
      );
    };

    /** Price the payment without touching any stored proof. */
    const quote = (draft: MeltDraft): Effect.Effect<MeltQuote, MeltError> =>
      Effect.gen(function* () {
        const wallet = yield* instances.get(draft.mint, sat);
        return (yield* createQuoteAt(wallet, draft)).quote;
      }).pipe(
        // The invoice never reaches the inspector; the quote holds no secrets.
        inspectOperationWith(
          inspector,
          "melt.quote",
          { mint: draft.mint },
          (priced) => priced,
        ),
      );

    const melt = (draft: MeltDraft): Effect.Effect<MeltReceipt, MeltError> =>
      Effect.gen(function* () {
        const wallet = yield* instances.get(draft.mint, sat);
        const keysetId = yield* boundKeysetId(draft.mint, wallet);
        const scope: CounterScope = { mint: draft.mint, unit: sat, keysetId };

        const quoteId = draft.quoteId;
        const priced =
          quoteId === undefined
            ? yield* createQuoteAt(wallet, draft)
            : yield* Effect.gen(function* () {
                const raw = yield* Effect.tryPromise({
                  try: () => wallet.checkMeltQuoteBolt11(quoteId),
                  catch: (error) => classifyMintError(draft.mint, error),
                });
                if (raw.request !== draft.invoice)
                  return yield* new MintRejected({
                    mint: draft.mint,
                    code: null,
                    detail: "melt quote does not match invoice",
                  });
                return { raw, quote: yield* toMeltQuote(draft.mint, raw) };
              });
        const { raw, quote } = priced;
        if (quoteStateOf(raw) !== "UNPAID") {
          return yield* new PaymentFailed({
            mint: quote.mint,
            quoteId: quote.quoteId,
            detail: "the melt quote is not unpaid; nothing was sent",
          });
        }
        if (quote.expiresAt !== null && (yield* nowSeconds) > quote.expiresAt) {
          return yield* new QuoteExpired({
            quoteId: quote.quoteId,
            mint: draft.mint,
          });
        }

        const spendContext = {
          proofStore,
          inspector,
          wallet,
          mint: draft.mint,
          unit: sat,
          reason: "melt",
        };
        const { spendable, available } =
          yield* selectSpendableProofs(spendContext);
        const needed = quote.amount + quote.feeReserve;
        if (available < needed) {
          return yield* new InsufficientFunds({
            mint: draft.mint,
            required: Amount.make(needed),
            available: NonNegativeAmount.make(available),
          });
        }

        const swapped = yield* swapProofsForAmount(
          { kv, inspector, wallet, scope },
          {
            amount: Amount.make(needed),
            proofs: spendable.map(toDomainProof),
            available,
            // The melt inputs must also cover their own cashu input fee, or
            // the mint rejects `amount + feeReserve` as short.
            includeFees: true,
          },
        );
        const inputs = toDomainProofs(swapped.send);
        if (inputs === null || inputs.length === 0) {
          return yield* new MintRejected({
            mint: draft.mint,
            code: null,
            detail: "mint returned malformed proofs from the swap",
          });
        }

        // The record, its held inputs, and the remainder all land before
        // the consumed sources are marked spent, so the funds are never
        // outside the store and a crash from here on is resumable.
        const pending = yield* records.create({
          quoteId: quote.quoteId,
          mint: draft.mint,
          unit: sat,
          keysetId,
          invoice: draft.invoice,
          amount: quote.amount,
          feeReserve: quote.feeReserve,
          inputsTotal: Amount.make(totalAmount(inputs)),
          expiresAt: quote.expiresAt,
          createdAt: UnixSeconds.make(yield* nowSeconds),
          counter: null,
        });
        const held = toNewProofs(
          swapped.send,
          draft.mint,
          sat,
          "held",
          pending.id,
        );
        if (held === null) {
          return yield* new MintRejected({
            mint: draft.mint,
            code: null,
            detail: "mint returned malformed proofs from the swap",
          });
        }
        yield* insertProofs(ctx, held, "melt");
        const outcome = yield* settleSwap(
          spendContext,
          spendable,
          swapped,
          "melt-keep",
        );
        if (outcome === null) {
          return yield* new MintRejected({
            mint: draft.mint,
            code: null,
            detail: "mint returned malformed proofs from the swap",
          });
        }

        return yield* executeMelt({
          wallet,
          raw,
          inputs: swapped.send,
          pending,
        });
      }).pipe(
        // The invoice never reaches the inspector; the receipt holds no secrets.
        inspectOperationWith(
          inspector,
          "melt.melt",
          { mint: draft.mint },
          (receipt) => receipt,
        ),
      );

    const status = (priced: MeltQuote) =>
      Effect.gen(function* () {
        const wallet = yield* instances.get(priced.mint, sat);
        const raw = yield* checkQuote(wallet, priced);
        const state = quoteStateOf(raw);
        if (state !== null) emitQuoteState(inspector, "melt", priced, state);
        return state;
      });

    const resultOf = (
      pending: PendingMelt,
      status: MeltResumeResult["status"],
      receipt: MeltReceipt | null,
    ): MeltResumeResult =>
      new MeltResumeResult({
        quoteId: pending.quoteId,
        mint: pending.mint,
        operationId: pending.id,
        amount: pending.amount,
        status,
        receipt,
      });

    /**
     * One persisted record. Only the mint's own answer moves it: PAID
     * finishes the melt, UNPAID returns the inputs, PENDING keeps both. A
     * mint that will not load or answer says nothing about the payment, so
     * the record is kept — quote expiry is not an unlock deadline.
     */
    const resumeOne = (pending: PendingMelt): Effect.Effect<MeltResumeResult> =>
      Effect.gen(function* () {
        const wallet = yield* instances.get(pending.mint, pending.unit);
        const state = quoteStateOf(yield* checkQuote(wallet, pending));
        if (state !== null) emitQuoteState(inspector, "melt", pending, state);
        const settled = yield* Effect.either(
          settleQuoteState(wallet, pending, state),
        );
        if (Either.isRight(settled)) {
          return resultOf(pending, "paid", settled.right);
        }
        switch (settled.left._tag) {
          case "PaymentFailed":
            return resultOf(pending, "unpaid", null);
          case "PaymentPending":
            return resultOf(pending, "pending", null);
          default:
            return yield* Effect.fail(settled.left);
        }
      }).pipe(
        inspectOperationWith(
          inspector,
          "melt.resume",
          {
            mint: pending.mint,
            quoteId: pending.quoteId,
            operationId: pending.id,
          },
          (result) => result,
        ),
        Effect.catchAll(() =>
          Effect.succeed(resultOf(pending, "unresolved", null)),
        ),
      );

    const resumePending: Effect.Effect<ReadonlyArray<MeltResumeResult>> =
      Effect.gen(function* () {
        const results: MeltResumeResult[] = [];
        for (const pending of yield* records.readAll) {
          results.push(yield* resumeOne(pending));
        }
        return results;
      }).pipe(
        inspectOperationWith(
          inspector,
          "melt.resumePending",
          {},
          (results) => results,
        ),
      );

    return { quote, melt, status, resumePending } as const;
  }),
}) {}
