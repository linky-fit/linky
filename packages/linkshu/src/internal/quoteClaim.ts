import type {
  MintProofsConfig,
  MintQuoteBolt11Response,
  Proof as CashuProof,
} from "@cashu/cashu-ts";
import { Effect, Either } from "effect";
import { MintRejected } from "../domain/errors";
import type { CounterLockTimeout, MintUnreachable } from "../domain/errors";
import type {
  Amount,
  CurrencyUnit,
  KeysetId,
  OperationId,
  TokenText,
} from "../domain/primitives";
import type { InspectorService } from "../inspector/Inspector";
import {
  classifyMintError,
  type LoadedWallet,
} from "../mint/internal/WalletInstances";
import type { KeyValueStoreService } from "../ports/KeyValueStore";
import type { ProofStoreService } from "../ports/ProofStore";
import {
  encodeCashuProofs,
  toDomainProofs,
} from "../token/internal/cashuProofs";
import { recoverFromCollision } from "./collisionRecovery";
import { advanceCounterTo, readCounter, withCounterLock } from "./counters";
import type { CounterScope } from "./counters";
import { isRecoverableOutputCollision } from "./outputCollisions";
import { insertProofs, storedSecrets, toNewProofs } from "./proofs";
import { checkProofStates, unspentProofs } from "./proofStates";
import type { QuoteRecord, QuoteRecordStore } from "./quoteRecords";

/**
 * Turning a settled mint quote into `available` proofs, shared by every flow
 * that mints against one (topup, autoswap claim). The caller owns the durable
 * record; this module owns the ordering that makes an interrupted claim
 * resumable: reserved counter slots are persisted before the outputs are
 * derived, the proofs are stored before the record closes, and a quote the
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

export class UnpaidMintQuote extends MintRejected {
  constructor(mint: MintUrlLike) {
    super({
      mint,
      code: null,
      detail: "mint reported the settled quote as unpaid",
    });
  }
}
type MintUrlLike = ConstructorParameters<typeof MintRejected>[0]["mint"];

/** The durable record's claim-relevant slice; flows carry their own extras. */
export interface ClaimableQuote extends QuoteRecord {
  readonly unit: CurrencyUnit;
  readonly keysetId: KeysetId;
  readonly amount: Amount;
}

export interface ClaimedQuote {
  readonly operationId: OperationId;
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
  readonly proofStore: ProofStoreService;
  readonly wallet: LoadedWallet;
  /** Inspector reason recorded on the proofs the claim stores. */
  readonly reason: string;
  /** Passed to the mint call as-is, e.g. the NUT-20 key of a locked quote. */
  readonly mintConfig?: MintProofsConfig | undefined;
  readonly records: QuoteRecordStore<R>;
}

const counterScopeOf = (record: ClaimableQuote): CounterScope => ({
  mint: record.mint,
  unit: record.unit,
  keysetId: record.keysetId,
});

export const checkMintQuote = (
  wallet: LoadedWallet,
  record: Pick<ClaimableQuote, "mint" | "quoteId">,
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
    const fresh = toNewProofs(
      proofs,
      record.mint,
      record.unit,
      "available",
      null,
    );
    if (encoded === null || fresh === null) {
      return yield* new MintRejected({
        mint: record.mint,
        code: null,
        detail: "mint returned malformed proofs from the mint quote",
      });
    }
    yield* insertProofs(ctx, fresh, ctx.reason);
    // Proofs first: a crash before the record closes costs one reclaim scan
    // on resume, never the funds.
    yield* ctx.records.settle(record, "done");
    return {
      operationId: record.id,
      tokenText: encoded.tokenText,
      amount: encoded.amount,
    };
  });

/**
 * The quote is spent at the mint but a crash lost the response: the outputs
 * the reserved slots derive are already signed, so NUT-09 hands them back.
 * Proofs a previous run already stored are not imported twice.
 */
const reclaimIssued = <R extends ClaimableQuote>(
  ctx: QuoteClaimContext<R>,
  record: R,
): Effect.Effect<ClaimedQuote, QuoteClaimError> =>
  Effect.gen(function* () {
    const counter = record.counter;
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

    const known = storedSecrets(yield* ctx.proofStore.loadAll);
    const unstored = proofs.filter((proof) => !known.has(proof.secret));
    if (unstored.length < proofs.length) {
      // A previous run stored (some of) them already; nothing left to mint.
      yield* ctx.records.settle(record, "done");
      const encoded = encodeCashuProofs({
        mint: record.mint,
        unit: record.unit,
        memo: null,
        proofs: restored.proofs,
      });
      if (encoded === null) {
        return yield* new MintRejected({
          mint: record.mint,
          code: null,
          detail: "mint returned malformed proofs from the reclaim scan",
        });
      }
      return {
        operationId: record.id,
        tokenText: encoded.tokenText,
        amount: encoded.amount,
      };
    }

    const states = yield* checkProofStates(ctx.wallet, record.mint, unstored);
    const spendable = unspentProofs(unstored, states);
    if (spendable.length === 0) {
      return yield* new MintRejected({
        mint: record.mint,
        code: null,
        detail: "quote already issued and its proofs are no longer unspent",
      });
    }
    // Only unspent, unstored proofs reach here, so storing them cannot
    // double-count balance.
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
          return yield* new UnpaidMintQuote(record.mint);
        }

        const counter = record.counter ?? (yield* readCounter(ctx.kv, scope));
        // Both writes land before the outputs are derived: a crash now
        // resumes onto the same slots instead of burning a second block.
        record = yield* ctx.records.withCounter(record, counter);
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
        record = yield* ctx.records.withCounter(
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
      }
      return yield* Effect.fail(classifyMintError(record.mint, lastCollision));
    }),
  );
};
