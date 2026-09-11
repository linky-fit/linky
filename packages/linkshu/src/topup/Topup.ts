import type { MintProofsConfig } from "@cashu/cashu-ts";
import { Duration, Effect, Either, Fiber } from "effect";
import type { Scope } from "effect";
import {
  MintRejected,
  QuoteAlreadyIssued,
  QuoteExpired,
} from "../domain/errors";
import type { MintUnreachable } from "../domain/errors";
import { UnixSeconds } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { inspectOperationWith, redactReceipt } from "../internal/operations";
import {
  checkMintQuote,
  claimMintQuote,
  QUOTE_ISSUED,
  QUOTE_UNPAID,
  UnpaidMintQuote,
} from "../internal/quoteClaim";
import { decodeMintQuote, emitQuoteState } from "../internal/quotes";
import { nowSeconds } from "../internal/time";
import { sat } from "../internal/units";
import type {
  QuoteClaimContext,
  QuoteClaimError,
} from "../internal/quoteClaim";
import {
  boundKeysetId,
  classifyMintError,
  WalletInstances,
} from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { KeyValueStore } from "../ports/KeyValueStore";
import { OperationStore } from "../ports/OperationStore";
import { ProofStore } from "../ports/ProofStore";
import { TopupQuote, TopupReceipt } from "./domain";
import type {
  PaidQuoteDraft,
  TopupAdoptError,
  TopupDraft,
  TopupError,
  TopupHandle,
  TopupLockingOptions,
} from "./domain";
import {
  awaitMintQuoteSettled,
  supportsMintQuoteSubscription,
} from "../internal/quoteSubscription";
import { topupRecords } from "./internal/topupRecords";
import type { PendingTopup } from "./internal/topupRecords";

/** Bolt11 mint quotes settle in seconds. */
const POLL_INTERVAL = Duration.seconds(5);
/** Transient poll failures are expected offline; a run of them is not. */
const MAX_CONSECUTIVE_POLL_FAILURES = 10;

const quoteOf = (pending: PendingTopup): TopupQuote =>
  new TopupQuote({
    quoteId: pending.quoteId,
    mint: pending.mint,
    amount: pending.amount,
    invoice: pending.invoice,
    expiresAt: pending.expiresAt,
  });

/**
 * A locked quote can only be minted with its key, so a record missing it is
 * rejected before any slot is reserved and stays pending for a resume that
 * brings the key.
 */
const mintConfigFor = (
  pending: PendingTopup,
  options: TopupLockingOptions,
): Effect.Effect<MintProofsConfig | undefined, MintRejected> => {
  if (!pending.locked) return Effect.succeed(undefined);
  if (options.lockingKey === undefined) {
    return Effect.fail(
      new MintRejected({
        mint: pending.mint,
        code: null,
        detail: "quote is locked to a key this wallet was not given",
      }),
    );
  }
  return Effect.succeed({ privkey: options.lockingKey });
};

/**
 * Self-recovering Lightning topup. `start` creates a mint quote, persists it
 * as a pending `topup` operation, and polls until it is claimable; minting
 * recovers counter collisions (including reclaiming already-signed outputs
 * via NUT-09) and records the reserved counter slots durably before the
 * outputs are derived, so a crash at any stage resumes without losing funds
 * or re-deriving over a burned slot. The proofs are stored before the
 * record closes, so the funds are never outside the store. `adopt` feeds the
 * same claim a quote some other party created and paid on the owner's
 * behalf.
 */
export class Topup extends Effect.Service<Topup>()("linkshu/Topup", {
  dependencies: [WalletInstances.Default],
  effect: Effect.gen(function* () {
    const kv = yield* KeyValueStore;
    const proofStore = yield* ProofStore;
    const operationStore = yield* OperationStore;
    const instances = yield* WalletInstances;
    const inspector = yield* Inspector.orNoop;
    const records = topupRecords({ kv, operationStore, inspector });

    /**
     * Polls until the mint reports the invoice settled. Transient failures
     * keep the poll alive — a topup must survive going offline — while a
     * definitive rejection (an unknown quote) ends it immediately. Expiry
     * needs the mint's own UNPAID answer: declaring it on the deadline alone
     * would drop the record for a quote that was paid while unreachable.
     */
    const pollUntilSettled = (
      wallet: LoadedWallet,
      pending: PendingTopup,
    ): Effect.Effect<void, MintUnreachable | MintRejected | QuoteExpired> =>
      Effect.gen(function* () {
        let lastState: string | null = null;
        let consecutiveFailures = 0;
        for (;;) {
          const outcome = yield* Effect.either(checkMintQuote(wallet, pending));
          if (Either.isLeft(outcome)) {
            const error = outcome.left;
            consecutiveFailures += 1;
            if (
              error._tag === "MintRejected" ||
              consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES
            ) {
              return yield* Effect.fail(error);
            }
          } else {
            consecutiveFailures = 0;
            const state = outcome.right.state;
            if (state !== lastState) {
              lastState = state;
              emitQuoteState(inspector, "topup", pending, state);
            }
            // PAID and ISSUED both mean the invoice settled; the mint step
            // decides between minting and reclaiming.
            if (state !== QUOTE_UNPAID) return;
            if ((yield* nowSeconds) > records.deadlineOf(pending)) {
              return yield* new QuoteExpired({
                quoteId: pending.quoteId,
                mint: pending.mint,
              });
            }
          }
          yield* Effect.sleep(POLL_INTERVAL);
        }
      });

    /**
     * NUT-17 shortens the wait for settlement. Polling keeps its full speed
     * because a proxy or CSP may block websockets even when the mint supports them.
     */
    const awaitSettled = (
      wallet: LoadedWallet,
      pending: PendingTopup,
    ): Effect.Effect<void, MintUnreachable | MintRejected | QuoteExpired> => {
      if (!supportsMintQuoteSubscription(wallet, pending.unit)) {
        return pollUntilSettled(wallet, pending);
      }
      const subscribed = awaitMintQuoteSettled(wallet, pending).pipe(
        Effect.map((quote) => {
          emitQuoteState(
            inspector,
            "topup",
            pending,
            quote.state,
            "subscription",
          );
        }),
        // The subscription retries its socket forever; if it ever gives up,
        // it falls silent and the poll decides.
        Effect.orElse(() => Effect.never),
      );
      return Effect.raceFirst(pollUntilSettled(wallet, pending), subscribed);
    };

    const claimContext = (
      wallet: LoadedWallet,
      mintConfig: MintProofsConfig | undefined,
    ): QuoteClaimContext<PendingTopup> => ({
      kv,
      inspector,
      proofStore,
      wallet,
      reason: "topup",
      mintConfig,
      records,
    });

    /** The shared claim, wearing topup's receipt. */
    const mintUnderLock = (
      wallet: LoadedWallet,
      pending: PendingTopup,
      mintConfig: MintProofsConfig | undefined,
    ): Effect.Effect<TopupReceipt, QuoteClaimError> =>
      Effect.map(
        claimMintQuote(claimContext(wallet, mintConfig), pending),
        (claimed) =>
          new TopupReceipt({
            operationId: claimed.operationId,
            tokenText: claimed.tokenText,
            mint: pending.mint,
            amount: claimed.amount,
            quoteId: pending.quoteId,
          }),
      );

    const complete = (
      pending: PendingTopup,
      options: TopupLockingOptions,
    ): Effect.Effect<TopupReceipt, TopupError> =>
      Effect.gen(function* () {
        const mintConfig = yield* mintConfigFor(pending, options);
        const wallet = yield* instances.get(pending.mint, pending.unit);
        for (;;) {
          yield* awaitSettled(wallet, pending);
          const outcome = yield* Effect.either(
            mintUnderLock(wallet, pending, mintConfig),
          );
          if (Either.isRight(outcome)) return outcome.right;
          if (!(outcome.left instanceof UnpaidMintQuote)) {
            return yield* Effect.fail(outcome.left);
          }
          emitQuoteState(inspector, "topup", pending, QUOTE_UNPAID);
          yield* Effect.sleep(POLL_INTERVAL);
        }
      }).pipe(
        Effect.tapError((error) =>
          // An expired quote that never reserved slots was never paid.
          error._tag === "QuoteExpired" && pending.counter === null
            ? records.settle(pending, "failed")
            : Effect.void,
        ),
        inspectOperationWith(
          inspector,
          "topup.complete",
          {
            mint: pending.mint,
            quoteId: pending.quoteId,
            amount: pending.amount,
          },
          redactReceipt,
        ),
      );

    /**
     * Polling runs in the scope, not in `result`: the topup completes itself
     * even when nobody awaits the handle, and closing the scope stops it
     * while the persisted record keeps the quote claimable.
     */
    const handleFor = (
      pending: PendingTopup,
      options: TopupLockingOptions,
    ): Effect.Effect<TopupHandle, never, Scope.Scope> =>
      Effect.map(Effect.forkScoped(complete(pending, options)), (fiber) => ({
        quote: quoteOf(pending),
        result: Fiber.join(fiber),
      }));

    /**
     * The record is persisted before the handle exists, so the invoice the
     * caller can act on is always one the package can finish or resume.
     */
    const start = (
      draft: TopupDraft,
    ): Effect.Effect<
      TopupHandle,
      MintUnreachable | MintRejected,
      Scope.Scope
    > =>
      Effect.gen(function* () {
        const wallet = yield* instances.get(draft.mint, sat);
        const keysetId = yield* boundKeysetId(draft.mint, wallet);
        const raw = yield* Effect.tryPromise({
          try: () => wallet.createMintQuoteBolt11(draft.amount),
          catch: (error) => classifyMintError(draft.mint, error),
        });
        const quote = yield* decodeMintQuote(draft.mint, raw);
        const pending = yield* records.create({
          quoteId: quote.quoteId,
          mint: draft.mint,
          unit: sat,
          keysetId,
          amount: draft.amount,
          invoice: quote.invoice,
          expiresAt: quote.expiresAt,
          createdAt: UnixSeconds.make(yield* nowSeconds),
          counter: null,
          locked: false,
        });
        emitQuoteState(inspector, "topup", pending, quote.state);
        return yield* handleFor(pending, {});
      }).pipe(
        inspectOperationWith(
          inspector,
          "topup.start",
          { mint: draft.mint, amount: draft.amount },
          (handle) => ({
            quoteId: handle.quote.quoteId,
            mint: handle.quote.mint,
            amount: handle.quote.amount,
            expiresAt: handle.quote.expiresAt,
          }),
        ),
      );

    /**
     * Mints a quote someone else created and paid for this wallet. The
     * caller vouches that the invoice settled, so there is no poll: the mint
     * is asked once, and a quote it already issued belongs to whichever
     * wallet minted it — unless a record of ours proves the attempt was
     * ours, in which case the claim's reclaim path takes over as usual.
     */
    const adopt = (
      draft: PaidQuoteDraft,
      options: TopupLockingOptions = {},
    ): Effect.Effect<TopupReceipt, TopupAdoptError> =>
      Effect.gen(function* () {
        const wallet = yield* instances.get(draft.mint, sat);
        const existing = yield* records.read(draft.mint, draft.quoteId);
        if (existing !== null) {
          const mintConfig = yield* mintConfigFor(existing, options);
          return yield* mintUnderLock(wallet, existing, mintConfig);
        }
        const keysetId = yield* boundKeysetId(draft.mint, wallet);
        const draftRecord = {
          quoteId: draft.quoteId,
          mint: draft.mint,
          unit: sat,
          keysetId,
          amount: draft.amount,
          invoice: draft.invoice,
          expiresAt: draft.expiresAt,
          createdAt: UnixSeconds.make(yield* nowSeconds),
          counter: null,
          locked: draft.locked,
        };
        if (draft.locked && options.lockingKey === undefined) {
          return yield* new MintRejected({
            mint: draft.mint,
            code: null,
            detail: "quote is locked to a key this wallet was not given",
          });
        }
        const quote = yield* checkMintQuote(wallet, draftRecord);
        emitQuoteState(inspector, "topup", draftRecord, quote.state);
        if (quote.state === QUOTE_ISSUED) {
          return yield* new QuoteAlreadyIssued({
            quoteId: draft.quoteId,
            mint: draft.mint,
          });
        }
        if (quote.state === QUOTE_UNPAID) {
          return yield* new MintRejected({
            mint: draft.mint,
            code: null,
            detail: "mint reports the adopted quote as unpaid",
          });
        }
        const pending = yield* records.create(draftRecord);
        const mintConfig = yield* mintConfigFor(pending, options);
        return yield* mintUnderLock(wallet, pending, mintConfig);
      }).pipe(
        inspectOperationWith(
          inspector,
          "topup.adopt",
          {
            mint: draft.mint,
            quoteId: draft.quoteId,
            amount: draft.amount,
            locked: draft.locked,
          },
          redactReceipt,
        ),
      );

    /**
     * Every record gets a handle — even one past its deadline. Only the
     * mint's own answer may retire a record (confirmed UNPAID → expired,
     * PAID/ISSUED → minted or reclaimed); a local clock check could prune a
     * quote that was paid right before the crash.
     */
    const resumePending = (
      options: TopupLockingOptions = {},
    ): Effect.Effect<ReadonlyArray<TopupHandle>, never, Scope.Scope> =>
      Effect.gen(function* () {
        const handles: TopupHandle[] = [];
        for (const pending of yield* records.readAll) {
          handles.push(yield* handleFor(pending, options));
        }
        return handles;
      }).pipe(
        inspectOperationWith(
          inspector,
          "topup.resumePending",
          {},
          (handles) => ({
            resumed: handles.map((handle) => handle.quote.quoteId),
          }),
        ),
      );

    return { start, adopt, resumePending } as const;
  }),
}) {}
