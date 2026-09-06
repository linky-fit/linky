import { Effect } from "effect";
import type { KeysetId } from "../domain/primitives";
import type { InspectorService } from "../inspector/Inspector";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import type { KeyValueStoreService } from "../ports/KeyValueStore";
import { advanceCounterTo } from "./counters";
import type { CounterScope } from "./counters";
import {
  isDuplicateOutputsError,
  isOutputsAlreadySignedError,
} from "./outputCollisions";

/** NUT-09 window scanned to find the last signed slot past a collision. */
const COLLISION_RESTORE_WINDOW = 100;

export interface CollisionRecoveryContext {
  readonly kv: KeyValueStoreService;
  readonly inspector: InspectorService;
  readonly wallet: LoadedWallet;
  readonly scope: CounterScope;
  /**
   * Blind advance when restore cannot locate the collision: the full counter
   * range the failed attempt may have burned (one output block per block the
   * operation derives).
   */
  readonly fallbackBump: number;
}

const probeLastSignedCounter = (
  wallet: LoadedWallet,
  start: number,
  keysetId: KeysetId,
): Effect.Effect<number | null> =>
  Effect.tryPromise(() =>
    wallet.restore(start, COLLISION_RESTORE_WINDOW, { keysetId }),
  ).pipe(
    Effect.map(({ lastCounterWithSignature }) =>
      typeof lastCounterWithSignature === "number" &&
      Number.isFinite(lastCounterWithSignature)
        ? lastCounterWithSignature
        : null,
    ),
    Effect.orElseSucceed(() => null),
  );

/**
 * Moves the counter past a recoverable output collision: for `outputs
 * already signed` and CDK `duplicate outputs` failures a NUT-09 probe locates the last signed
 * slot; otherwise (or when the probe fails) the counter jumps `fallbackBump`
 * ahead. Caller must hold the counter lock. Returns the counter now in
 * effect.
 */
export const recoverFromCollision = (
  ctx: CollisionRecoveryContext,
  counter: number,
  raw: unknown,
): Effect.Effect<number> =>
  Effect.gen(function* () {
    const lastSigned =
      isOutputsAlreadySignedError(raw) || isDuplicateOutputsError(raw)
        ? yield* probeLastSignedCounter(ctx.wallet, counter, ctx.scope.keysetId)
        : null;
    const target =
      lastSigned === null ? counter + ctx.fallbackBump : lastSigned + 1;
    return yield* advanceCounterTo(
      ctx.kv,
      ctx.inspector,
      ctx.scope,
      target,
      "collision-recovery",
    );
  });
