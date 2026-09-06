import { Effect, Either } from "effect";
import type { MintRejected, MintUnreachable } from "../../domain/errors";
import { unspentProofs } from "../../internal/proofStates";
import type { ProofStateEntry } from "../../internal/proofStates";
import type { Proof } from "../../token/domain";

/**
 * NUT-09 scan of one keyset's derivation tree. Kept free of services so the
 * scan strategy itself stays testable: the mint calls arrive as two effects.
 */

/** Counter positions scanned behind the cursor/counter high water. */
const RESTORE_RESCAN_WINDOW = 4000;
/** Consecutive empty positions tolerated before a scan gives up. */
export const RESTORE_GAP_LIMIT = 300;
/** Positions per restore request; cashu-ts issues one request per batch. */
export const RESTORE_BATCH_SIZE = 100;

export interface RestoreBatch {
  readonly proofs: ReadonlyArray<Proof>;
  /** Absolute position of the last slot the mint had signed; null for none. */
  readonly lastCounterWithSignature: number | null;
}

type MintFailure = MintUnreachable | MintRejected;

export interface KeysetScanInput {
  readonly restoreFrom: (
    start: number,
  ) => Effect.Effect<RestoreBatch, MintFailure>;
  readonly proofStates: (
    proofs: ReadonlyArray<Proof>,
  ) => Effect.Effect<ReadonlyArray<ProofStateEntry>, MintFailure>;
  /** Secrets already stored; restoring them again would duplicate rows. */
  readonly knownSecrets: ReadonlySet<string>;
  readonly cursor: number;
  readonly counter: number;
}

export type KeysetScan =
  | {
      readonly status: "ok";
      /** Where the next scan may resume; null when nothing was signed. */
      readonly nextCursor: number | null;
      readonly proofs: ReadonlyArray<Proof>;
    }
  | { readonly status: "unavailable" };

const nextCursorFrom = (
  ...positions: ReadonlyArray<number | null>
): number | null => {
  const last = Math.max(
    -1,
    ...positions.map((position) => position ?? -1).filter(Number.isFinite),
  );
  return last >= 0 ? last + 1 : null;
};

/**
 * Restored proofs worth persisting: not already stored, and confirmed unspent
 * by the mint. A failed state check imports nothing — an unconfirmed proof
 * would show up as balance the wallet cannot spend.
 */
const spendableProofs = (
  input: KeysetScanInput,
  restored: ReadonlyArray<Proof>,
): Effect.Effect<ReadonlyArray<Proof>> => {
  const fresh = restored.filter(
    (proof) => !input.knownSecrets.has(proof.secret),
  );
  return fresh.length === 0
    ? Effect.succeed([])
    : input.proofStates(fresh).pipe(
        Effect.map((states) => unspentProofs(fresh, states)),
        Effect.orElseSucceed(() => []),
      );
};

/**
 * Scans a window behind the high water first — that is where a crashed
 * operation leaves signatures the store never saw — and only falls back to
 * the full tree when the window comes up empty, which is the fresh-storage
 * case a seed-only recovery starts from.
 */
export const scanKeyset = (input: KeysetScanInput): Effect.Effect<KeysetScan> =>
  Effect.gen(function* () {
    const highWater = Math.max(input.cursor, input.counter);
    const start = Math.max(0, highWater - RESTORE_RESCAN_WINDOW);
    const windowed = yield* input.restoreFrom(start);

    let nextCursor = nextCursorFrom(windowed.lastCounterWithSignature);
    let proofs = yield* spendableProofs(input, windowed.proofs);

    if (proofs.length === 0 && start > 0) {
      // A failed deep pass keeps the windowed result rather than losing it.
      const deep = yield* Effect.either(input.restoreFrom(0));
      if (Either.isRight(deep)) {
        nextCursor = nextCursorFrom(
          windowed.lastCounterWithSignature,
          deep.right.lastCounterWithSignature,
        );
        proofs = yield* spendableProofs(input, deep.right.proofs);
      }
    }

    const scan: KeysetScan = { status: "ok", nextCursor, proofs };
    return scan;
  }).pipe(Effect.orElseSucceed((): KeysetScan => ({ status: "unavailable" })));
