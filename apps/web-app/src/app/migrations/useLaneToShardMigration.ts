/**
 * Copies the legacy per-scope owner lanes into the linksync shards on the first
 * launch after the update and, for the grace period (180 days from release
 * 26.9.18), re-copies rows an older app version wrote to a lane. It is the only code allowed to read the
 * legacy tables (`cashuToken`, `nostrMessage`, `nostrReaction`, `ownerMeta`,
 * the legacy chat columns on `contact`) and the only code that writes back to a
 * lane: it mirrors terminal `cashuProof.state = spent` to existing legacy proof
 * rows so older clients stop counting spent funds. Never copy new proofs or
 * spendable states back. Remove with the lane migration (see the removal gate
 * in app/migrations/AGENTS.md).
 */
import {
  linkshuServices,
  Tokens,
  type LegacyTokenRow,
} from "@linky-fit/linkshu";
import {
  makeWalletRepository,
  NonEmptyString100,
  type AppOwner,
  type LinkyStore,
} from "@linky-fit/linksync";
import { Effect, ManagedRuntime } from "effect";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { getInspectorEmissionEnabled } from "../../devtools/inspector/inspectorEnabled";
import { reportInspectorRows } from "../../devtools/inspector/reportInspectorRows";
import {
  createCashuOperationsAllQuery,
  createCashuProofsAllQuery,
  createCashuTokensAllQuery,
  createContactsAllQuery,
  createNostrIdentitiesAllQuery,
  createNostrMessagesAllQuery,
  createNostrReactionsAllQuery,
  createOwnerMetaAllQuery,
  createTransactionsAllQuery,
  evolu,
  getLinkyStore,
} from "../../evolu";
import { readStoredSlip39Seed } from "../../platform/identitySecrets";
import { localStorageKeyValueStore } from "../../platform/linkshu/localStorageKeyValueStore";
import { resolveLinkshuSeed } from "../../platform/linkshu/resolveLinkshuSeed";
import { useOnline } from "../../hooks/useOnline";
import { getUnknownErrorMessage } from "../../utils/unknown";
import { legacyProofsToMarkSpent } from "./legacySpentProofs";
import {
  deriveLegacyLaneOwners,
  isLaneGracePeriodActive,
  isLaneMigrationDoneLocally,
  markLaneMigrationDoneLocally,
  legacySnapshotKey,
  readLegacyLaneIndexes,
  runLaneToShardMigration,
  type LaneMigrationReport,
  type LegacyLaneSnapshot,
} from "./laneToShardMigration";

const INSPECTOR_CHANNEL = "evolu.migration";

const emit = (
  tag: string,
  summary: string,
  owners: ReadonlyArray<string>,
  payload: unknown,
  proofIds: ReadonlyArray<string> = [],
): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: INSPECTOR_CHANNEL,
      tag,
      summary,
      links: {
        owner: [...owners],
        ...(proofIds.length ? { proof: [...proofIds] } : {}),
      },
      payload,
    },
  ]);
};

const readLegacyLaneSnapshot = async (): Promise<LegacyLaneSnapshot> => {
  const [
    contacts,
    messages,
    reactions,
    tokens,
    proofs,
    operations,
    transactions,
    identities,
    ownerMeta,
  ] = await Promise.all([
    evolu.loadQuery(createContactsAllQuery()),
    evolu.loadQuery(createNostrMessagesAllQuery()),
    evolu.loadQuery(createNostrReactionsAllQuery()),
    evolu.loadQuery(createCashuTokensAllQuery()),
    evolu.loadQuery(createCashuProofsAllQuery()),
    evolu.loadQuery(createCashuOperationsAllQuery()),
    evolu.loadQuery(createTransactionsAllQuery()),
    evolu.loadQuery(createNostrIdentitiesAllQuery()),
    evolu.loadQuery(createOwnerMetaAllQuery()),
  ]);
  return {
    contacts,
    messages,
    reactions,
    tokens,
    proofs,
    operations,
    transactions,
    identities,
    ownerMeta,
  };
};

/** linkshu's legacy token ingest over the shard wallet; the runtime lives only for the call. */
const ingestLegacyTokensThroughShards = async (
  store: LinkyStore,
  rows: ReadonlyArray<LegacyTokenRow>,
): Promise<void> => {
  const wallet = makeWalletRepository(store);
  const runtime = ManagedRuntime.make(
    linkshuServices({
      bip39Seed: await resolveLinkshuSeed(),
      keyValueStore: localStorageKeyValueStore,
      proofStore: wallet.proofStore,
      operationStore: wallet.operationStore,
    }),
  );
  try {
    await runtime.runPromise(
      Effect.flatMap(Tokens, (tokens) => tokens.ingestLegacyRows(rows)),
    );
  } finally {
    await runtime.dispose();
  }
};

const countsByScope = (report: LaneMigrationReport) => {
  const scopes = new Map<
    string,
    Record<string, { ingested: number; skipped: number }>
  >();
  for (const { scope, table, ingested, skipped } of report.counts) {
    const tables = scopes.get(scope) ?? {};
    tables[table] = { ingested, skipped };
    scopes.set(scope, tables);
  }
  return scopes;
};

const bootLaneMigration = async (): Promise<void> => {
  const startedAtMs = Date.now();
  const firstRun = !isLaneMigrationDoneLocally();
  const gracePeriodActive = isLaneGracePeriodActive(startedAtMs);
  if (!firstRun && !gracePeriodActive) return;
  const store = await getLinkyStore();
  const seed = (await readStoredSlip39Seed())?.trim() ?? "";
  const ownerMeta = await evolu.loadQuery(createOwnerMetaAllQuery());
  const laneOwners: ReadonlyArray<AppOwner> = seed
    ? await deriveLegacyLaneOwners(
        seed,
        readLegacyLaneIndexes(ownerMeta, store.appOwner.id),
      )
    : [];
  const legacyOwners = [store.appOwner, ...laneOwners];
  const legacyOwnerIds = legacyOwners.map((owner) => owner.id);
  await Effect.runPromise(store.reconcileSync());

  // Legacy rows remain inputs; only terminal proof states are mirrored back.
  // After the grace period a first run ingests only the lanes held locally.
  if (gracePeriodActive) for (const owner of laneOwners) evolu.useOwner(owner);

  emit(
    firstRun ? "LaneMigrationStarted" : "LaneGracePeriodReingestStarted",
    firstRun
      ? `Migrating ${laneOwners.length} owner lanes into shards`
      : `Re-ingesting ${laneOwners.length} owner lanes into shards`,
    legacyOwnerIds,
    {
      firstRun,
      seedLogin: seed !== "",
      laneOwners: laneOwners.length,
      gracePeriodActive,
    },
  );

  const snapshot = await readLegacyLaneSnapshot();
  const report = await runLaneToShardMigration({
    store,
    snapshot,
    legacyOwnerIds: new Set(legacyOwnerIds),
    ingestLegacyTokens: (rows) => ingestLegacyTokensThroughShards(store, rows),
  });
  markLaneMigrationDoneLocally();

  const proofQuery = createCashuProofsAllQuery();
  let mirroring = false;
  let dirty = false;
  const mirrorSpentProofs = async (): Promise<void> => {
    dirty = true;
    if (mirroring) return;
    mirroring = true;
    try {
      while (dirty && isLaneGracePeriodActive(Date.now())) {
        dirty = false;
        const [legacy, shardCopies] = await Promise.all([
          evolu.loadQuery(proofQuery),
          Effect.runPromise(store.copies("cashu", "cashuProof")),
        ]);
        const changed = legacyProofsToMarkSpent(
          legacy,
          shardCopies,
          new Set(legacyOwnerIds),
        );
        for (const proof of changed) {
          const result = evolu.update(
            "cashuProof",
            { id: proof.id, state: NonEmptyString100.orThrow("spent") },
            { ownerId: proof.ownerId },
          );
          if (!result.ok) throw new Error("Legacy spent proof write failed");
        }
        if (changed.length > 0)
          emit(
            "LaneSpentProofsMirrored",
            `Marked ${changed.length} legacy proofs spent`,
            [...new Set(changed.map((proof) => proof.ownerId))],
            { proofIds: changed.map((proof) => proof.id) },
            changed.map((proof) => proof.id),
          );
      }
    } catch (error: unknown) {
      console.warn("[linky] legacy spent proof sync failed", error);
      reportAppLog({
        tag: "evolu.legacySpentProofSyncFailed",
        summary: "Could not mark legacy wallet proofs spent",
        payload: { error: getUnknownErrorMessage(error, "unknown") },
      });
    } finally {
      mirroring = false;
    }
  };
  evolu.subscribeQuery(proofQuery)(() => void mirrorSpentProofs());
  await mirrorSpentProofs();

  let lastSnapshotKey = legacySnapshotKey(snapshot, new Set(legacyOwnerIds));
  let indexesKey = JSON.stringify(
    readLegacyLaneIndexes(ownerMeta, store.appOwner.id),
  );
  let reingesting = false;
  let pending = false;
  const reingestLateRows = async (): Promise<void> => {
    pending = true;
    if (reingesting) return;
    reingesting = true;
    try {
      while (pending) {
        pending = false;
        if (!isLaneGracePeriodActive(Date.now())) return;
        const latest = await readLegacyLaneSnapshot();
        const indexes = readLegacyLaneIndexes(
          latest.ownerMeta,
          store.appOwner.id,
        );
        const nextIndexesKey = JSON.stringify(indexes);
        if (seed && nextIndexesKey !== indexesKey) {
          for (const owner of await deriveLegacyLaneOwners(seed, indexes)) {
            if (legacyOwnerIds.includes(owner.id)) continue;
            legacyOwnerIds.push(owner.id);
            evolu.useOwner(owner);
          }
          indexesKey = nextIndexesKey;
        }
        const ownerIds = new Set(legacyOwnerIds);
        const nextKey = legacySnapshotKey(latest, ownerIds);
        if (nextKey === lastSnapshotKey) continue;
        const ingested = await runLaneToShardMigration({
          store,
          snapshot: latest,
          legacyOwnerIds: ownerIds,
          ingestLegacyTokens: (rows) =>
            ingestLegacyTokensThroughShards(store, rows),
        });
        lastSnapshotKey = nextKey;
        await mirrorSpentProofs();
        emit(
          "LaneGracePeriodReingested",
          "Re-ingested legacy rows received after boot",
          legacyOwnerIds,
          { counts: ingested.counts },
        );
      }
    } catch (error: unknown) {
      console.warn("[linky] late lane migration failed", error);
      reportAppLog({
        tag: "evolu.laneMigrationFailed",
        summary: "Could not ingest late legacy rows",
        payload: { error: getUnknownErrorMessage(error, "unknown") },
      });
    } finally {
      reingesting = false;
    }
  };
  for (const query of [
    createContactsAllQuery(),
    createNostrMessagesAllQuery(),
    createNostrReactionsAllQuery(),
    createCashuTokensAllQuery(),
    createCashuProofsAllQuery(),
    createCashuOperationsAllQuery(),
    createTransactionsAllQuery(),
    createNostrIdentitiesAllQuery(),
    createOwnerMetaAllQuery(),
  ])
    evolu.subscribeQuery(query)(() => void reingestLateRows());
  // Late rows wait for hydration; the migrating screen waits only for the first run.
  void reingestLateRows();

  const shardOwnerIds = (await Effect.runPromise(store.syncOwners())).map(
    (owner) => owner.id,
  );
  if (firstRun) {
    for (const [scope, tables] of countsByScope(report)) {
      const ingested = Object.values(tables).reduce(
        (total, count) => total + count.ingested,
        0,
      );
      emit(
        "LaneMigrationScopeIngested",
        `Migrated ${ingested} ${scope} rows into the active shard`,
        [...legacyOwnerIds, ...shardOwnerIds],
        { scope, tables },
      );
    }
  }
  emit(
    firstRun ? "LaneMigrationDone" : "LaneGracePeriodReingested",
    firstRun
      ? `Owner lanes migrated in ${Date.now() - startedAtMs} ms`
      : `Owner lanes re-ingested in ${Date.now() - startedAtMs} ms`,
    [...legacyOwnerIds, ...shardOwnerIds],
    {
      firstRun,
      durationMs: Date.now() - startedAtMs,
      gracePeriodActive,
      counts: report.counts,
    },
  );
};

// One run per page load, shared by every mount (StrictMode mounts twice).
let bootRun: Promise<void> | null = null;

/**
 * Runs the lane-to-shard migration before the authenticated shell mounts and
 * says whether the "migrating data" screen should be up. The first run on a
 * device shows the screen; later boots re-ingest in the background for the
 * grace period. Ingest waits for hydration, so a device holding legacy rows
 * keeps the screen up until an Evolu relay has answered, and drops it for good
 * once the browser is offline: the shell shows the shards until the ingest
 * completes. A device holding none (a brand-new account, a restore) passes at
 * once and ingests the lanes that sync in later in the background. A failure logs,
 * leaves the done flag unset so the next boot retries, and lets the shell
 * mount: the lanes are still the app's data.
 */
export const useLaneToShardMigration = (): boolean => {
  // Suspends until Evolu has opened, the way the shell's own queries do, so a
  // database that never answers still reaches the boot watchdog instead of
  // committing a screen that cannot progress.
  React.use(getLinkyStore());
  const [migrating, setMigrating] = React.useState(
    () => !isLaneMigrationDoneLocally(),
  );
  const online = useOnline();
  React.useEffect(() => {
    if (!online) setMigrating(false);
  }, [online]);

  React.useEffect(() => {
    let cancelled = false;
    bootRun ??= bootLaneMigration().catch((error: unknown) => {
      console.warn("[linky] lane migration failed", error);
      reportAppLog({
        tag: "evolu.laneMigrationFailed",
        summary: "Owner lane migration failed; retrying on the next launch",
        payload: { error: getUnknownErrorMessage(error, "unknown") },
      });
    });
    void bootRun.then(() => {
      if (!cancelled) setMigrating(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return migrating;
};
