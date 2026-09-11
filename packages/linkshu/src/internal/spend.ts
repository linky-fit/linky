import type { SendResponse } from "@cashu/cashu-ts";
import { Effect, Either } from "effect";
import { InsufficientFunds } from "../domain/errors";
import type { MintRejected, MintUnreachable } from "../domain/errors";
import { NonNegativeAmount } from "../domain/primitives";
import type { Amount, CurrencyUnit, MintUrl } from "../domain/primitives";
import type { InspectorService } from "../inspector/Inspector";
import { classifyMintError } from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import type { KeyValueStoreService } from "../ports/KeyValueStore";
import type { ProofStoreService, StoredProof } from "../ports/ProofStore";
import type { Proof } from "../token/domain";
import { recoverFromCollision } from "./collisionRecovery";
import { advanceCounterTo, readCounter, withCounterLock } from "./counters";
import type { CounterScope } from "./counters";
import type { CounterLockTimeout } from "../domain/errors";
import {
  isInsufficientBalanceError,
  isRecoverableOutputCollision,
} from "./outputCollisions";
import {
  insertProofs,
  proofsAt,
  setProofState,
  toDomainProof,
  toNewProofs,
  totalAmount,
} from "./proofs";
import { checkProofStates, spentSecrets, unspentProofs } from "./proofStates";

/**
 * Shared machinery for operations that spend `available` proofs (send,
 * melt, autoswap): source selection with the NUT-07 pre-filter, the
 * deterministic swap that turns the pool into exact-amount proofs, and the
 * bookkeeping that settles the swap's inputs and change in the inventory.
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

export interface SpendContext {
  readonly proofStore: ProofStoreService;
  readonly inspector: InspectorService;
  readonly wallet: LoadedWallet;
  readonly mint: MintUrl;
  readonly unit: CurrencyUnit;
  /** Inspector reason for proofs the pre-filter marks spent. */
  readonly reason: string;
}

export interface SpendSelection {
  /** Confirmed-unspent `available` proofs, offered to the swap. */
  readonly spendable: ReadonlyArray<StoredProof>;
  /** Sum of `spendable`. */
  readonly available: number;
}

/**
 * The spendable pool at one mint: `available` proofs, NUT-07 checked. Proofs
 * the mint reports spent are marked so — definitive spend knowledge sticks
 * even when the operation itself fails afterwards. `PENDING`, unanswered,
 * and unrecognized proofs stay `available` and are simply not offered.
 */
export const selectSpendableProofs = (
  ctx: SpendContext,
): Effect.Effect<SpendSelection, MintUnreachable | MintRejected> =>
  Effect.gen(function* () {
    const candidates = proofsAt(
      yield* ctx.proofStore.loadAll,
      ctx.mint,
      ctx.unit,
    ).filter((proof) => proof.state === "available");
    const domain = candidates.map(toDomainProof);
    const states = yield* checkProofStates(ctx.wallet, ctx.mint, domain);
    const spent = spentSecrets(domain, states);
    const unspent = new Set(
      unspentProofs(domain, states).map((proof) => proof.secret),
    );
    yield* setProofState(
      ctx,
      candidates.filter((proof) => spent.has(proof.secret)),
      "spent",
      ctx.reason,
      null,
    );
    const spendable = candidates.filter((proof) => unspent.has(proof.secret));
    return { spendable, available: totalAmount(spendable) };
  });

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

export interface SwapOutcome {
  /** Fresh change the swap minted, now `available`. */
  readonly freshKeep: ReadonlyArray<StoredProof>;
  /** Offered proofs the swap consumed. */
  readonly consumed: ReadonlyArray<StoredProof>;
  /** Sum of every keep proof — fresh change plus passthrough inputs. */
  readonly keepAmount: number;
}

/**
 * Books a swap: fresh change is stored `available` before the consumed
 * inputs are marked `spent`, so the funds are never outside the store.
 * Passthrough inputs (offered but not consumed) are untouched. `null` when
 * the mint handed back malformed change.
 */
export const settleSwap = (
  ctx: SpendContext,
  offered: ReadonlyArray<StoredProof>,
  swapped: SendResponse,
  reason: string,
): Effect.Effect<SwapOutcome | null> =>
  Effect.gen(function* () {
    const offeredSecrets = new Set(offered.map((proof) => proof.secret));
    const keepSecrets = new Set(swapped.keep.map((proof) => proof.secret));
    const fresh = toNewProofs(
      swapped.keep.filter((proof) => !offeredSecrets.has(proof.secret)),
      ctx.mint,
      ctx.unit,
      "available",
      null,
    );
    if (fresh === null) return null;
    const freshKeep = yield* insertProofs(ctx, fresh, reason);
    const consumed = offered.filter((proof) => !keepSecrets.has(proof.secret));
    yield* setProofState(ctx, consumed, "spent", reason, null);
    return {
      freshKeep,
      consumed,
      keepAmount: swapped.keep.reduce(
        (sum, proof) => sum + proof.amount.toNumber(),
        0,
      ),
    };
  });
