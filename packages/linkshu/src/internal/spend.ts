import type { SendResponse } from "@cashu/cashu-ts";
import { Effect, Either, Schema } from "effect";
import { InsufficientFunds, TokenAlreadySpent } from "../domain/errors";
import type { MintRejected, MintUnreachable } from "../domain/errors";
import { NonNegativeAmount } from "../domain/primitives";
import type { Amount, CurrencyUnit, MintUrl } from "../domain/primitives";
import type { InspectorService } from "../inspector/Inspector";
import { classifyMintError } from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import type { KeyValueStoreService } from "../ports/KeyValueStore";
import type { StoredTokenRow, TokenStoreService } from "../ports/TokenStore";
import type { Proof } from "../token/domain";
import { transitionRow } from "../token/internal/lifecycle";
import { collectRowProofs } from "../token/internal/rowProofs";
import type { RowProofs } from "../token/internal/rowProofs";
import { recoverFromCollision } from "./collisionRecovery";
import { advanceCounterTo, readCounter, withCounterLock } from "./counters";
import type { CounterScope } from "./counters";
import type { CounterLockTimeout } from "../domain/errors";
import {
  isInsufficientBalanceError,
  isRecoverableOutputCollision,
} from "./outputCollisions";
import { checkProofStates, dedupeProofs, spentSecrets } from "./proofStates";

/**
 * Shared machinery for operations that spend `accepted` rows (send, melt):
 * source selection, the NUT-07 pre-filter with spent-row marking, and the
 * deterministic swap that turns the pool into exact-amount proofs.
 */

const MAX_SWAP_ATTEMPTS = 5;
/**
 * Deterministic counter block reserved for the swap's send outputs; keep
 * outputs start right after it. Advancing past `block + freshKeepCount`
 * therefore clears every counter either side could have used.
 */
const SWAP_OUTPUT_BLOCK = 64;
/** A failed attempt may have burned both blocks. */
const COLLISION_FALLBACK_BUMP = SWAP_OUTPUT_BLOCK * 2;

/** An `accepted` row spendable at the target mint, with its decoded proofs. */
export type AcceptedSource = RowProofs;

export const collectAcceptedSources = (
  rows: ReadonlyArray<StoredTokenRow>,
  mint: MintUrl,
  unit: CurrencyUnit,
  /** The mint's full keyset ids; expands short v2 ids in stored v4 tokens. */
  keysetIds: readonly string[],
): ReadonlyArray<AcceptedSource> =>
  collectRowProofs(
    rows.filter((row) => row.state === "accepted"),
    mint,
    unit,
    keysetIds,
  );

/** One state-check candidate per distinct secret (rows may share proofs). */
export const dedupeSourceProofs = (
  sources: ReadonlyArray<AcceptedSource>,
): ReadonlyArray<Proof> =>
  dedupeProofs(sources.flatMap((source) => source.proofs));

export interface SpendablePartition {
  /** Rows whose every proof the mint reports spent; dead, to be marked. */
  readonly fullySpentRows: ReadonlyArray<StoredTokenRow>;
  /** Rows still holding an unspent proof; the swap consumes them. */
  readonly liveRows: ReadonlyArray<StoredTokenRow>;
  /** Unspent proofs offered to the swap, deduped by secret. */
  readonly spendable: ReadonlyArray<Proof>;
  /** Sum of `spendable`. */
  readonly available: number;
}

export const partitionBySpentSecrets = (
  sources: ReadonlyArray<AcceptedSource>,
  spentSecrets: ReadonlySet<string>,
): SpendablePartition => {
  const fullySpentRows: StoredTokenRow[] = [];
  const liveRows: StoredTokenRow[] = [];
  const seen = new Set<string>();
  const spendable: Proof[] = [];
  let available = 0;
  for (const source of sources) {
    if (source.proofs.every((proof) => spentSecrets.has(proof.secret))) {
      fullySpentRows.push(source.row);
      continue;
    }
    liveRows.push(source.row);
    for (const proof of source.proofs) {
      if (spentSecrets.has(proof.secret) || seen.has(proof.secret)) continue;
      seen.add(proof.secret);
      spendable.push(proof);
      available += proof.amount;
    }
  }
  return { fullySpentRows, liveRows, spendable, available };
};

/** Serialized onto rows NUT-07 reports fully spent. */
const encodeSpentRowError = Schema.encodeSync(
  Schema.parseJson(TokenAlreadySpent),
);

export interface SpendContext {
  readonly tokenStore: TokenStoreService;
  readonly inspector: InspectorService;
  readonly wallet: LoadedWallet;
  readonly mint: MintUrl;
  readonly unit: CurrencyUnit;
  /** Lifecycle-event reason for rows the pre-filter marks spent. */
  readonly reason: string;
}

export interface SpendSelection {
  /** Rows the swap will consume (they hold at least one unspent proof). */
  readonly liveRows: ReadonlyArray<StoredTokenRow>;
  /** Unspent proofs offered to the swap, deduped by secret. */
  readonly spendable: ReadonlyArray<Proof>;
  /** Sum of `spendable`. */
  readonly available: number;
}

/**
 * The spendable pool at one mint: `accepted` rows decoded, NUT-07 checked,
 * and rows the mint reports fully spent marked `error` — definitive spend
 * knowledge sticks even when the operation itself fails afterwards.
 */
export const selectSpendableProofs = (
  ctx: SpendContext,
): Effect.Effect<SpendSelection, MintUnreachable | MintRejected> =>
  Effect.gen(function* () {
    const sources = collectAcceptedSources(
      yield* ctx.tokenStore.loadAll,
      ctx.mint,
      ctx.unit,
      ctx.wallet.keyChain.getKeysets().map((keyset) => keyset.id),
    );
    const candidates = dedupeSourceProofs(sources);
    const states = yield* checkProofStates(ctx.wallet, ctx.mint, candidates);
    const partition = partitionBySpentSecrets(
      sources,
      spentSecrets(candidates, states),
    );
    yield* Effect.forEach(
      partition.fullySpentRows,
      (row) =>
        // `accepted` → `error` is always legal; failing here is a package bug.
        Effect.orDie(
          transitionRow(
            ctx.tokenStore,
            ctx.inspector,
            row,
            "error",
            ctx.reason,
            {
              error: encodeSpentRowError(
                new TokenAlreadySpent({ mint: ctx.mint }),
              ),
            },
          ),
        ),
      { discard: true },
    );
    return {
      liveRows: partition.liveRows,
      spendable: partition.spendable,
      available: partition.available,
    };
  });

/**
 * Removes the source rows a swap consumed, sparing any physical row a fresh
 * post-swap insert reused: cashu-ts passes unselected proofs through to the
 * keep side unchanged, so a fully-unselected source row can re-encode
 * byte-identically — a store deriving ids from `originalTokenText` then
 * hands the change insert that source row's own id, and removing it would
 * destroy the just-persisted funds.
 */
export const removeConsumedRows = (
  tokenStore: TokenStoreService,
  liveRows: ReadonlyArray<StoredTokenRow>,
  inserted: ReadonlyArray<StoredTokenRow>,
): Effect.Effect<void> => {
  const insertedIds = new Set(inserted.map((row) => row.id));
  return Effect.forEach(
    liveRows.filter((row) => !insertedIds.has(row.id)),
    (row) => tokenStore.remove(row.id),
    { discard: true },
  );
};

export interface SwapContext {
  readonly kv: KeyValueStoreService;
  readonly inspector: InspectorService;
  readonly wallet: LoadedWallet;
  readonly scope: CounterScope;
}

export interface SwapRequest {
  readonly amount: Amount;
  readonly proofs: ReadonlyArray<Proof>;
  /** Sum of `proofs`; reported on `InsufficientFunds`. */
  readonly available: number;
  /** Make the send outputs also cover their own input fee at the mint. */
  readonly includeFees?: boolean;
}

/**
 * Swaps `amount` out of the offered proofs with disjoint send/keep
 * deterministic counter blocks, recovering counter collisions under the
 * lease-locked counter. The counter is advanced past the full send block
 * plus every fresh keep output before the response is returned.
 */
export const swapProofsForAmount = (
  ctx: SwapContext,
  request: SwapRequest,
): Effect.Effect<
  SendResponse,
  InsufficientFunds | MintUnreachable | MintRejected | CounterLockTimeout
> =>
  withCounterLock(
    ctx.kv,
    ctx.scope,
  )(
    Effect.gen(function* () {
      const offeredSecrets = new Set(
        request.proofs.map((proof) => proof.secret),
      );
      let counter = yield* readCounter(ctx.kv, ctx.scope);
      let lastCollision: unknown = null;
      for (let attempt = 0; attempt < MAX_SWAP_ATTEMPTS; attempt += 1) {
        const outcome = yield* Effect.either(
          Effect.tryPromise({
            try: () =>
              ctx.wallet.send(
                request.amount,
                [...request.proofs],
                request.includeFees === true
                  ? { includeFees: true }
                  : undefined,
                {
                  send: { type: "deterministic", counter },
                  keep: {
                    type: "deterministic",
                    counter: counter + SWAP_OUTPUT_BLOCK,
                  },
                },
              ),
            catch: (error): unknown => error,
          }),
        );
        if (Either.isRight(outcome)) {
          const swapped = outcome.right;
          // Keep mixes fresh change with passthrough inputs; only the
          // fresh ones consumed keep-block counters.
          const freshKeepCount = swapped.keep.filter(
            (proof) => !offeredSecrets.has(proof.secret),
          ).length;
          yield* advanceCounterTo(
            ctx.kv,
            ctx.inspector,
            ctx.scope,
            counter + SWAP_OUTPUT_BLOCK + freshKeepCount,
            "used",
          );
          return swapped;
        }
        const raw = outcome.left;
        if (isInsufficientBalanceError(raw)) {
          return yield* new InsufficientFunds({
            mint: ctx.scope.mint,
            required: request.amount,
            available: NonNegativeAmount.make(request.available),
          });
        }
        if (!isRecoverableOutputCollision(raw)) {
          return yield* Effect.fail(classifyMintError(ctx.scope.mint, raw));
        }
        lastCollision = raw;
        counter = yield* recoverFromCollision(
          {
            kv: ctx.kv,
            inspector: ctx.inspector,
            wallet: ctx.wallet,
            scope: ctx.scope,
            fallbackBump: COLLISION_FALLBACK_BUMP,
          },
          counter,
          raw,
        );
      }
      return yield* Effect.fail(
        classifyMintError(ctx.scope.mint, lastCollision),
      );
    }),
  );
