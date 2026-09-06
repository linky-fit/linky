import type {
  MeltProofsResponse,
  MeltQuoteBolt11Response,
  Proof as CashuProof,
} from "@cashu/cashu-ts";
import { Duration, Effect, Either, Schema } from "effect";
import {
  InsufficientFunds,
  MintRejected,
  PaymentFailed,
  QuoteExpired,
} from "../domain/errors";
import type { MintUnreachable } from "../domain/errors";
import { Amount, NonNegativeAmount, UnixSeconds } from "../domain/primitives";
import type { MintUrl } from "../domain/primitives";
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
import { checkProofStates, unspentProofs } from "../internal/proofStates";
import { pollUntil } from "../internal/poll";
import { decodeQuoteId, emitQuoteState } from "../internal/quotes";
import {
  removeConsumedRows,
  selectSpendableProofs,
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
import { TokenStore } from "../ports/TokenStore";
import type { StoredTokenRow } from "../ports/TokenStore";
import type { Proof } from "../token/domain";
import {
  encodeCashuProofs,
  encodeProofs,
  toDomainProofs,
} from "../token/internal/cashuProofs";
import { insertRowInState, transitionRow } from "../token/internal/lifecycle";
import { MeltQuote, MeltReceipt } from "./domain";
import type { MeltDraft, MeltError } from "./domain";
import { blankOutputCount } from "./internal/blankOutputs";

const MAX_MELT_ATTEMPTS = 5;
/**
 * Blind advance past a collision the NUT-09 probe cannot locate: orphaned
 * *unsigned* blanks at the mint (NUT 11004) never restore, so the jump must
 * clear a whole run of them, not just this melt's own blank range.
 */
const MELT_COLLISION_FALLBACK_BUMP = 64;
/** Bounded wait for a PENDING Lightning payment before giving up. */
const PENDING_POLL_ATTEMPTS = 6;
const PENDING_POLL_INTERVAL = Duration.millis(500);

const decodeAmount = Schema.decodeUnknownOption(Amount);
const decodeReserve = Schema.decodeUnknownOption(NonNegativeAmount);
const decodeExpiry = Schema.decodeUnknownOption(UnixSeconds);
const decodeQuoteState = Schema.decodeUnknownOption(
  Schema.Literal("UNPAID", "PENDING", "PAID"),
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
const quoteStateOf = (
  raw: MeltQuoteBolt11Response,
): "UNPAID" | "PENDING" | "PAID" | null => {
  const decoded = decodeQuoteState(
    typeof raw.state === "string" ? raw.state.trim().toUpperCase() : raw.state,
  );
  return decoded._tag === "Some" ? decoded.value : null;
};

/** Everything the post-swap melt steps need to settle one payment. */
interface MeltExecution {
  readonly wallet: LoadedWallet;
  readonly scope: CounterScope;
  readonly raw: MeltQuoteBolt11Response;
  readonly quote: MeltQuote;
  readonly inputs: ReadonlyArray<CashuProof>;
  /** Sum of `inputs`; fixed by the exact-amount swap. */
  readonly inputsTotal: number;
  /** The `reserved` row holding the melt inputs while the mint has them. */
  readonly inputsRow: StoredTokenRow;
}

/**
 * Paying a bolt11 invoice from the wallet: quote, swap `amount + feeReserve`
 * out (fee-inclusive), melt, and account NUT-08 blank outputs by advancing
 * the deterministic counter past the full blank range — not just the change
 * actually returned — so orphaned blind signatures at the mint can never
 * collide with later derivations. Change and any post-swap remainder are
 * persisted as `accepted` rows before the receipt resolves; a failure after
 * the swap loses no funds.
 */
export class Melt extends Effect.Service<Melt>()("linkshu/Melt", {
  dependencies: [WalletInstances.Default],
  effect: Effect.gen(function* () {
    const kv = yield* KeyValueStore;
    const tokenStore = yield* TokenStore;
    const instances = yield* WalletInstances;
    const inspector = yield* Inspector.orNoop;

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
      quote: MeltQuote,
    ): Effect.Effect<MeltQuoteBolt11Response, MintUnreachable | MintRejected> =>
      Effect.tryPromise({
        try: () => wallet.checkMeltQuoteBolt11(quote.quoteId),
        catch: (error) => classifyMintError(quote.mint, error),
      });

    /** The mint never executed (or reversed) the melt: inputs return to balance. */
    const releaseInputsRow = (
      row: StoredTokenRow,
      reason: string,
    ): Effect.Effect<void> =>
      // `reserved` → `accepted` is always legal; failing here is a package bug.
      Effect.orDie(
        transitionRow(tokenStore, inspector, row, "accepted", reason),
      );

    /**
     * Re-derives the melt's blank range via NUT-09 when the change proofs did
     * not arrive with the response (deferred change, lost response). Only
     * proofs the mint explicitly reports unspent count.
     */
    const reclaimBlankChange = (
      wallet: LoadedWallet,
      scope: CounterScope,
      blankStart: number,
      blanks: number,
    ): Effect.Effect<ReadonlyArray<Proof>, MintUnreachable | MintRejected> =>
      Effect.gen(function* () {
        if (blanks === 0) return [];
        const restored = yield* Effect.tryPromise({
          try: () =>
            wallet.restore(blankStart, blanks, { keysetId: scope.keysetId }),
          catch: (error) => classifyMintError(scope.mint, error),
        });
        const proofs = toDomainProofs(restored.proofs);
        if (proofs === null) {
          return yield* new MintRejected({
            mint: scope.mint,
            code: null,
            detail: "mint returned malformed proofs from the change reclaim",
          });
        }
        const states = yield* checkProofStates(wallet, scope.mint, proofs);
        return unspentProofs(proofs, states);
      });

    /**
     * The payment settled: NUT-08 change becomes an `accepted` row before the
     * consumed inputs row is dropped, so the funds are never outside the
     * store; the actual fee is what the inputs lost beyond invoice + change.
     */
    const finishPaid = (
      exec: MeltExecution,
      change: ReadonlyArray<Proof>,
    ): Effect.Effect<MeltReceipt, MintRejected> =>
      Effect.gen(function* () {
        const encodedChange =
          change.length > 0
            ? encodeProofs({
                mint: exec.quote.mint,
                unit: sat,
                memo: null,
                proofs: change,
              })
            : null;
        if (change.length > 0 && encodedChange === null) {
          return yield* new MintRejected({
            mint: exec.quote.mint,
            code: null,
            detail: "mint returned malformed change proofs from the melt",
          });
        }
        const changeAmount = encodedChange?.amount ?? 0;
        const feePaid = exec.inputsTotal - exec.quote.amount - changeAmount;
        if (feePaid < 0) {
          return yield* new MintRejected({
            mint: exec.quote.mint,
            code: null,
            detail: "mint returned more change than the melt inputs held",
          });
        }
        if (encodedChange !== null) {
          yield* insertRowInState(tokenStore, inspector, {
            originalTokenText: encodedChange.tokenText,
            tokenText: encodedChange.tokenText,
            state: "accepted",
            reason: "melt-change",
          });
        }
        yield* tokenStore.remove(exec.inputsRow.id);
        return new MeltReceipt({
          mint: exec.quote.mint,
          quoteId: exec.quote.quoteId,
          paidAmount: exec.quote.amount,
          feeReserve: exec.quote.feeReserve,
          feePaid: NonNegativeAmount.make(feePaid),
          changeAmount: NonNegativeAmount.make(changeAmount),
        });
      });

    const paymentPending = (quote: MeltQuote): PaymentFailed =>
      new PaymentFailed({
        mint: quote.mint,
        quoteId: quote.quoteId,
        detail:
          "lightning payment still pending at the mint; the inputs stay reserved until validation resolves them",
      });

    /**
     * Bounded wait on a PENDING payment. If it never resolves, the inputs
     * stay `reserved`: the mint holds them while the payment is in flight,
     * so they are neither balance nor destroyable — validation (NUT-07)
     * resolves the row once the payment settles either way, and any change
     * is recoverable from the already-burned blank range via restore.
     */
    const awaitPendingSettlement = (
      exec: MeltExecution,
      blankStart: number,
      blanks: number,
    ): Effect.Effect<MeltReceipt, MeltError> =>
      Effect.gen(function* () {
        let lastState = "PENDING";
        // A missed poll is no information; the bounded poll decides.
        const pollState = Effect.map(
          Effect.either(checkQuote(exec.wallet, exec.quote)),
          Either.match({
            onLeft: () => null,
            onRight: (checked) => {
              const state = quoteStateOf(checked);
              if (state !== null && state !== lastState) {
                lastState = state;
                emitQuoteState(inspector, "melt", exec.quote, state);
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
        if (state === "PAID") {
          const change = yield* reclaimBlankChange(
            exec.wallet,
            exec.scope,
            blankStart,
            blanks,
          );
          return yield* finishPaid(exec, change);
        }
        if (state === "UNPAID") {
          yield* releaseInputsRow(exec.inputsRow, "melt-unpaid");
          return yield* new PaymentFailed({
            mint: exec.quote.mint,
            quoteId: exec.quote.quoteId,
            detail: "the lightning payment failed at the mint",
          });
        }
        return yield* Effect.fail(paymentPending(exec.quote));
      });

    const settleMeltResponse = (
      exec: MeltExecution,
      response: MeltProofsResponse<MeltQuoteBolt11Response>,
      blankStart: number,
      blanks: number,
    ): Effect.Effect<MeltReceipt, MeltError> =>
      Effect.gen(function* () {
        const state = quoteStateOf(response.quote);
        if (state !== null)
          emitQuoteState(inspector, "melt", exec.quote, state);
        if (state === "PAID") {
          const change = Array.isArray(response.change)
            ? toDomainProofs(response.change)
            : null;
          return yield* finishPaid(
            exec,
            change ??
              // Malformed inline change never drops funds: the blank range
              // is deterministic, so the signed change restores from seed.
              (yield* reclaimBlankChange(
                exec.wallet,
                exec.scope,
                blankStart,
                blanks,
              )),
          );
        }
        if (state === "UNPAID") {
          yield* releaseInputsRow(exec.inputsRow, "melt-unpaid");
          return yield* new PaymentFailed({
            mint: exec.quote.mint,
            quoteId: exec.quote.quoteId,
            detail: "mint reported the melt quote unpaid after the melt",
          });
        }
        // PENDING, or a state we do not recognize: wait, then leave reserved.
        return yield* awaitPendingSettlement(exec, blankStart, blanks);
      });

    /**
     * The melt response was lost in transit; the payment may have happened.
     * Only the mint's own PAID answer finishes the melt — on any other
     * outcome the inputs stay `reserved` (the payment may yet settle) and
     * the transient failure surfaces unchanged.
     */
    const resolveLostMeltResponse = (
      exec: MeltExecution,
      blankStart: number,
      blanks: number,
      failure: MintUnreachable,
    ): Effect.Effect<MeltReceipt, MeltError> =>
      Effect.gen(function* () {
        const checked = yield* Effect.either(
          checkQuote(exec.wallet, exec.quote),
        );
        if (Either.isRight(checked) && quoteStateOf(checked.right) === "PAID") {
          emitQuoteState(inspector, "melt", exec.quote, "PAID");
          const change = yield* reclaimBlankChange(
            exec.wallet,
            exec.scope,
            blankStart,
            blanks,
          );
          return yield* finishPaid(exec, change);
        }
        return yield* Effect.fail(failure);
      });

    /**
     * Melts under the counter lock. The full blank range is burned before
     * every attempt reaches the mint: the mint keeps every blank it saw —
     * signed or not — so later derivations must never revisit those slots,
     * and a restore after the melt reproduces exactly this accounting.
     */
    const executeMelt = (
      exec: MeltExecution,
    ): Effect.Effect<MeltReceipt, MeltError> =>
      withCounterLock(
        kv,
        exec.scope,
      )(
        Effect.gen(function* () {
          const blanks = blankOutputCount(exec.inputsTotal - exec.quote.amount);
          let lastCollision: unknown = null;
          for (let attempt = 0; attempt < MAX_MELT_ATTEMPTS; attempt += 1) {
            const counter = yield* readCounter(kv, exec.scope);
            yield* advanceCounterTo(
              kv,
              inspector,
              exec.scope,
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
              return yield* settleMeltResponse(
                exec,
                outcome.right,
                counter,
                blanks,
              );
            }
            const raw = outcome.left;
            if (isRecoverableOutputCollision(raw)) {
              lastCollision = raw;
              yield* recoverFromCollision(
                {
                  kv,
                  inspector,
                  wallet: exec.wallet,
                  scope: exec.scope,
                  fallbackBump: MELT_COLLISION_FALLBACK_BUMP,
                },
                counter,
                raw,
              );
              continue;
            }
            const failure = classifyMintError(exec.scope.mint, raw);
            if (failure._tag === "MintUnreachable") {
              return yield* resolveLostMeltResponse(
                exec,
                counter,
                blanks,
                failure,
              );
            }
            // A definitive rejection means the mint never executed the melt.
            yield* releaseInputsRow(exec.inputsRow, "melt-rejected");
            return yield* Effect.fail(failure);
          }
          yield* releaseInputsRow(exec.inputsRow, "melt-rejected");
          return yield* Effect.fail(
            classifyMintError(exec.scope.mint, lastCollision),
          );
        }),
      );

    /** Price the payment without touching any stored token. */
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
        if (quoteStateOf(raw) !== "UNPAID") return yield* paymentPending(quote);
        if (quote.expiresAt !== null && (yield* nowSeconds) > quote.expiresAt) {
          return yield* new QuoteExpired({
            quoteId: quote.quoteId,
            mint: draft.mint,
          });
        }

        const { liveRows, spendable, available } = yield* selectSpendableProofs(
          {
            tokenStore,
            inspector,
            wallet,
            mint: draft.mint,
            unit: sat,
            reason: "melt",
          },
        );
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
            proofs: spendable,
            available,
            // The melt inputs must also cover their own cashu input fee, or
            // the mint rejects `amount + feeReserve` as short.
            includeFees: true,
          },
        );
        const inputsEncoded = encodeCashuProofs({
          mint: draft.mint,
          unit: sat,
          memo: null,
          proofs: swapped.send,
        });
        const keepEncoded =
          swapped.keep.length > 0
            ? encodeCashuProofs({
                mint: draft.mint,
                unit: sat,
                memo: null,
                proofs: swapped.keep,
              })
            : null;
        if (
          inputsEncoded === null ||
          (swapped.keep.length > 0 && keepEncoded === null)
        ) {
          return yield* new MintRejected({
            mint: draft.mint,
            code: null,
            detail: "mint returned malformed proofs from the swap",
          });
        }

        // Both post-swap rows land before the consumed sources go away, so
        // the funds are never outside the store: the remainder as balance,
        // the melt inputs as a `reserved` row for as long as the mint may
        // hold them.
        const keepRow =
          keepEncoded === null
            ? null
            : yield* insertRowInState(tokenStore, inspector, {
                originalTokenText: keepEncoded.tokenText,
                tokenText: keepEncoded.tokenText,
                state: "accepted",
                reason: "melt-keep",
              });
        const inputsRow = yield* insertRowInState(tokenStore, inspector, {
          originalTokenText: inputsEncoded.tokenText,
          tokenText: inputsEncoded.tokenText,
          state: "reserved",
          reason: "melt",
        });
        yield* removeConsumedRows(
          tokenStore,
          liveRows,
          keepRow === null ? [inputsRow] : [keepRow, inputsRow],
        );

        return yield* executeMelt({
          wallet,
          scope,
          raw,
          quote,
          inputs: swapped.send,
          inputsTotal: inputsEncoded.amount,
          inputsRow,
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
    return { quote, melt, status } as const;
  }),
}) {}
