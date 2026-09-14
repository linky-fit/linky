import { Effect, Schema } from "effect";
import { MintRejected } from "../domain/errors";
import { KeysetId, NonNegativeAmount } from "../domain/primitives";
import type { MintUrl, ProofId } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import {
  advanceCounterTo,
  COUNTER_LOCK_KEY_PREFIX,
  DETERMINISTIC_COUNTER_KEY_PREFIX,
  readCounter,
  withCounterLock,
} from "../internal/counters";
import type { CounterScope } from "../internal/counters";
import { inspectOperation, inspectOperationWith } from "../internal/operations";
import {
  domainToNewProofs,
  insertProofs,
  storedSecrets,
  totalAmount,
} from "../internal/proofs";
import { checkProofStates } from "../internal/proofStates";
import { collectKnownMints } from "../mint/internal/knownMints";
import {
  classifyMintError,
  WalletInstances,
} from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { KeyValueStore } from "../ports/KeyValueStore";
import { OperationStore } from "../ports/OperationStore";
import { ProofStore } from "../ports/ProofStore";
import { toDomainProofs } from "../token/internal/cashuProofs";
import { RestoreReport } from "./domain";
import type { RestoreDraft, RestoreProgress } from "./domain";
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
import { reclaimProofs } from "../token/internal/reclaim";

const isKeysetId = Schema.is(KeysetId);

/** Every key describing a position only the current seed can reproduce. */
const SEED_BOUND_KEY_PREFIXES = [
  DETERMINISTIC_COUNTER_KEY_PREFIX,
  COUNTER_LOCK_KEY_PREFIX,
  RESTORE_CURSOR_KEY_PREFIX,
];

const finitePosition = (value: number | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

interface Restored {
  readonly proofIds: ReadonlyArray<ProofId>;
  readonly amount: number;
}

const NOTHING_RESTORED: Restored = { proofIds: [], amount: 0 };

const mergeRestored = (left: Restored, right: Restored): Restored => ({
  proofIds: [...left.proofIds, ...right.proofIds],
  amount: left.amount + right.amount,
});

/**
 * NUT-09 recovery of deterministic proofs from the seed. Per mint, unit, and
 * keyset: scan a bounded window behind the persisted cursor/counter high
 * water (falling back to a full scan from zero when the window finds
 * nothing), keep only unspent proofs whose secrets are not already stored,
 * persist them as `available`, and advance both the restore cursor and the
 * deterministic counter past the last signature found. Unreachable mints
 * are reported, not failed on.
 */
export class Restore extends Effect.Service<Restore>()("linkshu/Restore", {
  dependencies: [WalletInstances.Default],
  effect: Effect.gen(function* () {
    const kv = yield* KeyValueStore;
    const proofStore = yield* ProofStore;
    const operationStore = yield* OperationStore;
    const instances = yield* WalletInstances;
    const inspector = yield* Inspector.orNoop;
    const ctx = { proofStore, inspector };

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
    ): Effect.Effect<Restored | null> => {
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
            // stored proofs this one must not import again. Any state
            // counts — a spent proof restored again would be balance the
            // mint will not honor.
            knownSecrets: storedSecrets(yield* proofStore.loadAll),
            cursor: yield* readRestoreCursor(kv, scope),
            counter: yield* readCounter(kv, scope),
          });
          if (scan.status === "unavailable") return null;

          // Proofs are stored before the cursor moves past them, so a crash
          // here costs a rescan, never the funds.
          const inserted = yield* insertProofs(
            ctx,
            domainToNewProofs(scan.proofs, mint, sat, "available", null),
            "restore",
          );
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
          return {
            proofIds: inserted.map((proof) => proof.id),
            amount: totalAmount(scan.proofs),
          };
        }),
      ).pipe(Effect.catchAll(() => Effect.succeed(null)));
    };

    const prepareMint = (mint: MintUrl) =>
      Effect.gen(function* () {
        const wallet = yield* instances.get(mint, sat);
        const keysetIds = yield* keysetsToScan(wallet, mint);
        return { mint, wallet, keysetIds };
      }).pipe(Effect.catchAll(() => Effect.succeed(null)));

    const restoreWithProofIds = (
      draft: RestoreDraft,
      onProgress?: (progress: RestoreProgress) => void,
    ) =>
      Effect.gen(function* () {
        const mints = [
          ...new Set(
            draft.mints ??
              (yield* collectKnownMints(kv, proofStore, operationStore)),
          ),
        ];
        const scannedMints: MintUrl[] = [];
        const unavailableMints: MintUrl[] = [];
        let restored = NOTHING_RESTORED;
        let progress: RestoreProgress = {
          phase: "preparing",
          completedKeysets: 0,
          totalKeysets: 0,
          totalMints: mints.length,
        };
        onProgress?.(progress);
        const plans = yield* Effect.forEach(mints, (mint) =>
          Effect.map(prepareMint(mint), (plan) => {
            if (plan === null) unavailableMints.push(mint);
            return plan;
          }),
        );
        progress = {
          ...progress,
          phase: "scanning",
          totalKeysets: plans.reduce(
            (total, plan) => total + (plan?.keysetIds.length ?? 0),
            0,
          ),
        };
        onProgress?.(progress);

        for (const plan of plans) {
          if (plan === null) continue;
          let complete = true;
          for (const keysetId of plan.keysetIds) {
            const scanned = yield* restoreKeyset(
              plan.wallet,
              plan.mint,
              keysetId,
            );
            if (scanned === null) complete = false;
            else restored = mergeRestored(restored, scanned);
            progress = {
              ...progress,
              completedKeysets: progress.completedKeysets + 1,
            };
            onProgress?.(progress);
          }
          if (complete) scannedMints.push(plan.mint);
          else unavailableMints.push(plan.mint);
        }

        return {
          proofIds: restored.proofIds,
          progress,
          report: new RestoreReport({
            restoredAmount: NonNegativeAmount.make(restored.amount),
            restoredProofs: restored.proofIds.length,
            scannedMints,
            unavailableMints,
          }),
        };
      }).pipe(
        inspectOperationWith(
          inspector,
          "restore.restore",
          {
            mints: draft.mints ?? null,
          },
          (result) => result.report,
        ),
      );

    const restore = (
      draft: RestoreDraft,
      onProgress?: (progress: RestoreProgress) => void,
    ): Effect.Effect<RestoreReport> =>
      Effect.map(
        restoreWithProofIds(draft, onProgress),
        (result) => result.report,
      );

    const restoreAndReclaim = (
      draft: RestoreDraft,
      onProgress?: (progress: RestoreProgress) => void,
    ) =>
      Effect.gen(function* () {
        const { report, proofIds, progress } = yield* restoreWithProofIds(
          draft,
          onProgress,
        );
        onProgress?.({ ...progress, phase: "refreshing" });
        const reclaim = yield* reclaimProofs(
          { kv, proofStore, operationStore, instances, inspector },
          proofIds,
        );
        return { restore: report, reclaim };
      });

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

    return { restore, restoreAndReclaim, wipeSeedBoundState } as const;
  }),
}) {}
