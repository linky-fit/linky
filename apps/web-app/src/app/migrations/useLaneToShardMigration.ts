import type { AppOwner } from "@evolu/common";
import { linkshuServices, Tokens, type LegacyTokenRow } from "@linky/linkshu";
import { makeWalletRepository, type LinkyStore } from "@linky/linksync";
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
import { getUnknownErrorMessage } from "../../utils/unknown";
import {
  deriveLegacyLaneOwners,
  isLaneGracePeriodActive,
  isLaneMigrationDoneLocally,
  markLaneMigrationDoneLocally,
  readLaneMigrationCutoffMs,
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
): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: INSPECTOR_CHANNEL,
      tag,
      summary,
      links: { owner: [...owners] },
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
  const cutoffMs = await Effect.runPromise(readLaneMigrationCutoffMs(store));
  await Effect.runPromise(store.reconcileSync());

  if (!isLaneGracePeriodActive(cutoffMs, startedAtMs)) {
    markLaneMigrationDoneLocally();
    return;
  }

  // Read-only for the grace period: an older app version may still write here.
  for (const owner of laneOwners) evolu.useOwner(owner);

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
      cutoffMs,
    },
  );

  const report = await runLaneToShardMigration({
    store,
    snapshot: await readLegacyLaneSnapshot(),
    legacyOwnerIds: new Set(legacyOwnerIds),
    ingestLegacyTokens: (rows) => ingestLegacyTokensThroughShards(store, rows),
    nowMs: startedAtMs,
  });
  markLaneMigrationDoneLocally();

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
      cutoffMs: report.cutoffMs,
      pointersWritten: report.pointersWritten,
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
 * grace period. A failure logs, leaves the done flag unset so the next boot
 * retries, and lets the shell mount: the lanes are still the app's data.
 */
export const useLaneToShardMigration = (): boolean => {
  // Suspends until Evolu has opened, the way the shell's own queries do, so a
  // database that never answers still reaches the boot watchdog instead of
  // committing a screen that cannot progress.
  React.use(getLinkyStore());
  const [migrating, setMigrating] = React.useState(
    () => !isLaneMigrationDoneLocally(),
  );

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
