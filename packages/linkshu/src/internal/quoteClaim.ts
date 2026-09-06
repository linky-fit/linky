import type {
  MintProofsConfig,
  MintQuoteBolt11Response,
  Proof as CashuProof,
} from "@cashu/cashu-ts";
import { Effect, Either } from "effect";
import { MintRejected } from "../domain/errors";
import type { CounterLockTimeout, MintUnreachable } from "../domain/errors";
import { Amount } from "../domain/primitives";
import type {
  CurrencyUnit,
  KeysetId,
  TokenRowId,
  TokenText,
} from "../domain/primitives";
import type { InspectorService } from "../inspector/Inspector";
import {
  classifyMintError,
  type LoadedWallet,
} from "../mint/internal/WalletInstances";
import type { KeyValueStoreService } from "../ports/KeyValueStore";
import type { TokenStoreService } from "../ports/TokenStore";
import {
  encodeCashuProofs,
  toDomainProofs,
} from "../token/internal/cashuProofs";
import { insertRowInState } from "../token/internal/lifecycle";
import {
  collectRowProofs,
  totalProofAmount,
} from "../token/internal/rowProofs";
import { recoverFromCollision } from "./collisionRecovery";
import { advanceCounterTo, readCounter, withCounterLock } from "./counters";
import type { CounterScope } from "./counters";
import { isRecoverableOutputCollision } from "./outputCollisions";
import type { PendingRecord, PendingRecordStore } from "./pendingRecords";
import { checkProofStates, unspentProofs } from "./proofStates";

/**
 * Turning a settled mint quote into an `accepted` row, shared by every flow
 * that mints against one (topup, autoswap claim). The caller owns the durable
 * record; this module owns the ordering that makes an interrupted claim
 * resumable: reserved counter slots are persisted before the outputs are
 * derived, the row is written before the record is cleared, and a quote the
 * mint already reports ISSUED is reclaimed via NUT-09 instead of minted twice.
 */

/**
 * Deterministic slots reserved per mint attempt, and therefore the NUT-09
 * window a reclaim scans: the outputs of one claim always fall inside it.
 */
const QUOTE_OUTPUT_BLOCK = 64;
const MAX_MINT_ATTEMPTS = 5;

export const QUOTE_UNPAID = "UNPAID";
export const QUOTE_ISSUED = "ISSUED";

/** The durable record's claim-relevant slice; flows carry their own extras. */
export interface ClaimableQuote extends PendingRecord {
  readonly unit: CurrencyUnit;
  readonly keysetId: KeysetId;
  readonly amount: Amount;
  /**
   * First deterministic slot reserved for this quote's mint attempt, or null
   * before any attempt.
   */
  readonly mintCounter: number | null;
}

export interface ClaimedQuote {
  readonly rowId: TokenRowId;
  readonly tokenText: TokenText;
  readonly amount: Amount;
}

export type QuoteClaimError =
  | MintUnreachable
  | MintRejected
  | CounterLockTimeout;

export interface QuoteClaimContext<R extends ClaimableQuote> {
  readonly kv: KeyValueStoreService;
  readonly inspector: InspectorService;
  readonly tokenStore: TokenStoreService;
  readonly wallet: LoadedWallet;
  /** Lifecycle reason recorded on the row the claim inserts. */
  readonly reason: string;
  /** Passed to the mint call as-is, e.g. the NUT-20 key of a locked quote. */
  readonly mintConfig?: MintProofsConfig | undefined;
  readonly withMintCounter: (record: R, counter: number) => R;
  readonly records: PendingRecordStore<R>;
}

const counterScopeOf = (record: ClaimableQuote): CounterScope => ({
  mint: record.mint,
  unit: record.unit,
  keysetId: record.keysetId,
});

export const checkMintQuote = (
  wallet: LoadedWallet,
  record: ClaimableQuote,
): Effect.Effect<MintQuoteBolt11Response, MintUnreachable | MintRejected> =>
  Effect.tryPromise({
    try: () => wallet.checkMintQuoteBolt11(record.quoteId),
    catch: (error) => classifyMintError(record.mint, error),
  });

const persistMinted = <R extends ClaimableQuote>(
  ctx: QuoteClaimContext<R>,
  record: R,
  proofs: ReadonlyArray<CashuProof>,
): Effect.Effect<ClaimedQuote, MintRejected> =>
  Effect.gen(function* () {
    const encoded = encodeCashuProofs({
      mint: record.mint,
      unit: record.unit,
      memo: null,
      proofs,
    });
    if (encoded === null) {
      return yield* new MintRejected({
        mint: record.mint,
        code: null,
        detail: "mint returned malformed proofs from the mint quote",
      });
    }
    const row = yield* insertRowInState(ctx.tokenStore, ctx.inspector, {
      originalTokenText: encoded.tokenText,
      tokenText: encoded.tokenText,
      state: "accepted",
      reason: ctx.reason,
    });
    // Row first: a crash before the record is cleared costs one reclaim scan
    // on resume, never the funds.
    yield* ctx.records.remove(ctx.kv, record);
    return {
      rowId: row.id,
      tokenText: encoded.tokenText,
      amount: encoded.amount,
    };
  });

/**
 * The quote is spent at the mint but a crash lost the response: the outputs
 * the reserved slots derive are already signed, so NUT-09 hands them back.
 * Proofs a previous run already stored resolve to that row instead of being
 * imported twice.
 */
const reclaimIssued = <R extends ClaimableQuote>(
  ctx: QuoteClaimContext<R>,
  record: R,
): Effect.Effect<ClaimedQuote, QuoteClaimError> =>
  Effect.gen(function* () {
    const counter = record.mintCounter;
    if (counter === null) {
      return yield* new MintRejected({
        mint: record.mint,
        code: null,
        detail:
          "quote already issued by an attempt that reserved no counters; run restore to recover the proofs",
      });
    }
    const restored = yield* Effect.tryPromise({
      try: () =>
        ctx.wallet.restore(counter, QUOTE_OUTPUT_BLOCK, {
          keysetId: record.keysetId,
        }),
      catch: (error) => classifyMintError(record.mint, error),
    });
    const proofs = toDomainProofs(restored.proofs);
    if (proofs === null) {
      return yield* new MintRejected({
        mint: record.mint,
        code: null,
        detail: "mint returned malformed proofs from the reclaim scan",
      });
    }

    const rowProofs = collectRowProofs(
      yield* ctx.tokenStore.loadAll,
      record.mint,
      record.unit,
      ctx.wallet.keyChain.getKeysets().map((keyset) => keyset.id),
    );
    const restoredSecrets = new Set(proofs.map((proof) => proof.secret));
    const known = rowProofs.find(({ proofs: stored }) =>
      stored.some((proof) => restoredSecrets.has(proof.secret)),
    );
    if (known !== undefined) {
      yield* ctx.records.remove(ctx.kv, record);
      return {
        rowId: known.row.id,
        tokenText: known.row.tokenText,
        amount: Amount.make(totalProofAmount(known.proofs)),
      };
    }

    const states = yield* checkProofStates(ctx.wallet, record.mint, proofs);
    const spendable = unspentProofs(proofs, states);
    if (spendable.length === 0) {
      return yield* new MintRejected({
        mint: record.mint,
        code: null,
        detail: "quote already issued and its proofs are no longer unspent",
      });
    }
    // Only unspent, unstored proofs reach here, so re-encoding them from the
    // reclaim scan cannot double-count balance.
    const reclaimed = restored.proofs.filter((proof) =>
      spendable.some((candidate) => candidate.secret === proof.secret),
    );
    return yield* persistMinted(ctx, record, reclaimed);
  });

/**
 * Mints the settled quote under the counter lock. Every attempt re-reads the
 * quote state first: a lost response looks exactly like a counter collision
 * from here, and only the mint's own `ISSUED` distinguishes "already minted,
 * reclaim it" from "someone else burned these slots, move past them".
 */
export const claimMintQuote = <R extends ClaimableQuote>(
  ctx: QuoteClaimContext<R>,
  pending: R,
): Effect.Effect<ClaimedQuote, QuoteClaimError> => {
  const scope = counterScopeOf(pending);
  return withCounterLock(
    ctx.kv,
    scope,
  )(
    Effect.gen(function* () {
      let record = pending;
      let lastCollision: unknown = null;
      for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt += 1) {
        const quote = yield* checkMintQuote(ctx.wallet, record);
        if (quote.state === QUOTE_ISSUED) {
          return yield* reclaimIssued(ctx, record);
        }
        if (quote.state === QUOTE_UNPAID) {
          return yield* new MintRejected({
            mint: record.mint,
            code: null,
            detail: "mint reported the settled quote as unpaid",
          });
        }

        const counter =
          record.mintCounter ?? (yield* readCounter(ctx.kv, scope));
        record = ctx.withMintCounter(record, counter);
        // Both writes land before the outputs are derived: a crash now
        // resumes onto the same slots instead of burning a second block.
        yield* ctx.records.write(ctx.kv, record);
        yield* advanceCounterTo(
          ctx.kv,
          ctx.inspector,
          scope,
          counter + QUOTE_OUTPUT_BLOCK,
          "used",
        );

        const outcome = yield* Effect.either(
          Effect.tryPromise({
            try: () =>
              ctx.wallet.mintProofsBolt11(
                record.amount,
                record.quoteId,
                ctx.mintConfig,
                { type: "deterministic", counter },
              ),
            catch: (error): unknown => error,
          }),
        );
        if (Either.isRight(outcome)) {
          return yield* persistMinted(ctx, record, outcome.right);
        }
        const raw = outcome.left;
        if (!isRecoverableOutputCollision(raw)) {
          return yield* Effect.fail(classifyMintError(record.mint, raw));
        }
        lastCollision = raw;
        record = ctx.withMintCounter(
          record,
          yield* recoverFromCollision(
            {
              kv: ctx.kv,
              inspector: ctx.inspector,
              wallet: ctx.wallet,
              scope,
              fallbackBump: QUOTE_OUTPUT_BLOCK,
            },
            counter,
            raw,
          ),
        );
        yield* ctx.records.write(ctx.kv, record);
      }
      return yield* Effect.fail(classifyMintError(record.mint, lastCollision));
    }),
  );
};
