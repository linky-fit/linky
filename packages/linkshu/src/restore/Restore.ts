import { Effect, Schema } from "effect";
import { MintRejected } from "../domain/errors";
import { KeysetId, NonNegativeAmount } from "../domain/primitives";
import type { MintUrl, TokenRowId } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import {
  advanceCounterTo,
  COUNTER_LOCK_KEY_PREFIX,
  DETERMINISTIC_COUNTER_KEY_PREFIX,
  readCounter,
  withCounterLock,
} from "../internal/counters";
import type { CounterScope } from "../internal/counters";
import { inspectOperation } from "../internal/operations";
import { checkProofStates } from "../internal/proofStates";
import { collectKnownMints } from "../mint/internal/knownMints";
import {
  classifyMintError,
  WalletInstances,
} from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { KeyValueStore } from "../ports/KeyValueStore";
import { TokenStore } from "../ports/TokenStore";
import { decodeTokenText } from "../token/codec";
import type { Proof } from "../token/domain";
import { encodeProofs, toDomainProofs } from "../token/internal/cashuProofs";
import { insertRowInState } from "../token/internal/lifecycle";
import { RestoreReport } from "./domain";
import type { RestoreDraft } from "./domain";
import {
  advanceRestoreCursor,
  readRestoreCursor,
  readSeenKeysets,
  rememberKeysets,
  RESTORE_CURSOR_KEY_PREFIX,
} from "./internal/restoreState";
import {
  RESTORE_BATCH_SIZE,
  RESTORE_GAP_LIMIT,
  scanKeyset,
} from "./internal/scan";
import { sat } from "../internal/units";

const isKeysetId = Schema.is(KeysetId);

/** Proofs per restored row; one huge token would be unwieldy to spend. */
const ROW_PROOF_CHUNK = 200;

/** Every key describing a position only the current seed can reproduce. */
const SEED_BOUND_KEY_PREFIXES = [
  DETERMINISTIC_COUNTER_KEY_PREFIX,
  COUNTER_LOCK_KEY_PREFIX,
  RESTORE_CURSOR_KEY_PREFIX,
];

const chunk = <T>(
  items: ReadonlyArray<T>,
  size: number,
): ReadonlyArray<T[]> => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const finitePosition = (value: number | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

interface RestoredRows {
  readonly rows: ReadonlyArray<TokenRowId>;
  readonly amount: number;
}

const NOTHING_RESTORED: RestoredRows = { rows: [], amount: 0 };

const mergeRestored = (
  left: RestoredRows,
  right: RestoredRows,
): RestoredRows => ({
  rows: [...left.rows, ...right.rows],
  amount: left.amount + right.amount,
});

/**
 * NUT-09 recovery of deterministic proofs from the seed. Per mint, unit, and
 * keyset: scan a bounded window behind the persisted cursor/counter high
 * water (falling back to a full scan from zero when the window finds
 * nothing), keep only unspent proofs whose secrets are not already stored,
 * persist them as `accepted` rows, and advance both the restore cursor and
 * the deterministic counter past the last signature found. Unreachable
 * mints are reported, not failed on.
 */
export class Restore extends Effect.Service<Restore>()("linkshu/Restore", {
  dependencies: [WalletInstances.Default],
  effect: Effect.gen(function* () {
    const kv = yield* KeyValueStore;
    const tokenStore = yield* TokenStore;
    const instances = yield* WalletInstances;
    const inspector = yield* Inspector.orNoop;

    const batchRestoreAt = (
      wallet: LoadedWallet,
      mint: MintUrl,
      keysetId: KeysetId,
      start: number,
    ) =>
      Effect.tryPromise({
        try: () =>
          wallet.batchRestore(
            RESTORE_GAP_LIMIT,
            RESTORE_BATCH_SIZE,
            start,
            keysetId,
          ),
        catch: (error) => classifyMintError(mint, error),
      }).pipe(
        Effect.flatMap((batch) => {
          const proofs = toDomainProofs(batch.proofs);
          return proofs === null
            ? new MintRejected({
                mint,
                code: null,
                detail: "mint returned malformed proofs from restore",
              })
            : Effect.succeed({
                proofs,
                lastCounterWithSignature: finitePosition(
                  batch.lastCounterWithSignature,
                ),
              });
        }),
      );

    /** Keysets the mint lists now, plus every one it has ever shown us. */
    const keysetsToScan = (
      wallet: LoadedWallet,
      mint: MintUrl,
    ): Effect.Effect<ReadonlyArray<KeysetId>> =>
      Effect.gen(function* () {
        const live = wallet.keyChain
          .getKeysets()
          .filter((keyset) => keyset.toMintKeyset().unit === sat)
          .flatMap((keyset) => (isKeysetId(keyset.id) ? [keyset.id] : []));
        yield* rememberKeysets(kv, mint, sat, live);
        const seen = yield* readSeenKeysets(kv, mint, sat);
        return [...new Set([...live, ...seen])];
      });

    /** Secrets already stored, in any state: they must not be restored twice. */
    const storedSecrets = (
      keysetIds: ReadonlyArray<KeysetId>,
    ): Effect.Effect<Set<string>> =>
      Effect.map(tokenStore.loadAll, (rows) => {
        const secrets = new Set<string>();
        for (const row of rows) {
          const decoded = decodeTokenText(row.tokenText, keysetIds);
          if (decoded === null) continue;
          for (const proof of decoded.proofs) secrets.add(proof.secret);
        }
        return secrets;
      });

    const persistRestored = (
      mint: MintUrl,
      proofs: ReadonlyArray<Proof>,
    ): Effect.Effect<RestoredRows> =>
      Effect.reduce(
        chunk(proofs, ROW_PROOF_CHUNK),
        NOTHING_RESTORED,
        (restored, proofChunk) =>
          Effect.gen(function* () {
            const encoded = encodeProofs({
              mint,
              unit: sat,
              memo: null,
              proofs: proofChunk,
            });
            if (encoded === null) return restored;
            const row = yield* insertRowInState(tokenStore, inspector, {
              originalTokenText: encoded.tokenText,
              tokenText: encoded.tokenText,
              state: "accepted",
              reason: "restore",
            });
            return mergeRestored(restored, {
              rows: [row.id],
              amount: encoded.amount,
            });
          }),
      );

    /**
     * One keyset's tree, under the counter lock: nothing else may derive from
     * it while restore decides where the tree ends. `null` reports that the
     * scan made no progress — an unreachable mint, or a lock another context
     * holds.
     */
    const restoreKeyset = (
      wallet: LoadedWallet,
      mint: MintUrl,
      keysetId: KeysetId,
      keysetIds: ReadonlyArray<KeysetId>,
    ): Effect.Effect<RestoredRows | null> => {
      const scope: CounterScope = { mint, unit: sat, keysetId };
      return withCounterLock(
        kv,
        scope,
      )(
        Effect.gen(function* () {
          const scan = yield* scanKeyset({
            restoreFrom: (start) =>
              batchRestoreAt(wallet, mint, keysetId, start),
            proofStates: (proofs) => checkProofStates(wallet, mint, proofs),
            // Read inside the lock: a restore that just released it may have
            // persisted rows this one must not import again.
            knownSecrets: yield* storedSecrets(keysetIds),
            cursor: yield* readRestoreCursor(kv, scope),
            counter: yield* readCounter(kv, scope),
          });
          if (scan.status === "unavailable") return null;

          // Proofs become rows before the cursor moves past them, so a crash
          // here costs a rescan, never the funds.
          const restored = yield* persistRestored(mint, scan.proofs);
          if (scan.nextCursor !== null) {
            yield* advanceRestoreCursor(kv, scope, scan.nextCursor);
            yield* advanceCounterTo(
              kv,
              inspector,
              scope,
              scan.nextCursor,
              "restore",
            );
          }
          return restored;
        }),
      ).pipe(Effect.catchAll(() => Effect.succeed(null)));
    };

    /** `null` when the mint could not be scanned at all. */
    const restoreMint = (
      mint: MintUrl,
    ): Effect.Effect<{ restored: RestoredRows; complete: boolean } | null> =>
      Effect.gen(function* () {
        const wallet = yield* instances.get(mint, sat);
        const keysetIds = yield* keysetsToScan(wallet, mint);
        let restored = NOTHING_RESTORED;
        let complete = true;
        for (const keysetId of keysetIds) {
          const scanned = yield* restoreKeyset(
            wallet,
            mint,
            keysetId,
            keysetIds,
          );
          if (scanned === null) complete = false;
          else restored = mergeRestored(restored, scanned);
        }
        return { restored, complete };
      }).pipe(Effect.catchAll(() => Effect.succeed(null)));

    const restore = (draft: RestoreDraft): Effect.Effect<RestoreReport> =>
      Effect.gen(function* () {
        const mints = draft.mints ?? (yield* collectKnownMints(kv, tokenStore));
        const scannedMints: MintUrl[] = [];
        const unavailableMints: MintUrl[] = [];
        let restored = NOTHING_RESTORED;

        for (const mint of mints) {
          const outcome = yield* restoreMint(mint);
          if (outcome === null) {
            unavailableMints.push(mint);
            continue;
          }
          restored = mergeRestored(restored, outcome.restored);
          // A mint is either fully scanned or reported as not scanned; a
          // keyset the scan could not reach leaves funds unaccounted for.
          if (outcome.complete) scannedMints.push(mint);
          else unavailableMints.push(mint);
        }

        return new RestoreReport({
          restoredAmount: NonNegativeAmount.make(restored.amount),
          rows: restored.rows,
          scannedMints,
          unavailableMints,
        });
      }).pipe(
        inspectOperation(inspector, "restore.restore", {
          mints: draft.mints ?? null,
        }),
      );

    /**
     * Remove every counter, cursor, and lease keyed to the current seed's
     * derivation tree. Mandatory after replacing the seed: the old values
     * describe positions the new seed cannot reproduce.
     */
    const wipeSeedBoundState: Effect.Effect<void> = Effect.forEach(
      SEED_BOUND_KEY_PREFIXES,
      (prefix) =>
        Effect.flatMap(kv.listKeys(prefix), (keys) =>
          Effect.forEach(keys, (key) => kv.remove(key), { discard: true }),
        ),
      { discard: true },
    ).pipe(inspectOperation(inspector, "restore.wipeSeedBoundState", {}));

    return { restore, wipeSeedBoundState } as const;
  }),
}) {}
