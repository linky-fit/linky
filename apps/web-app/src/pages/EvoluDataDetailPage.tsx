import {
  Button,
  Chip,
  Disclosure,
  EmptyState,
  ListRow,
  LoadingState,
  Progress,
  Row,
  Section,
  Stack,
  Text,
} from "@linky-fit/ui";
import { EvoluHistoryTable } from "../components/EvoluHistoryTable";
import { EvoluCurrentTable } from "../components/EvoluCurrentTable";
import type { LinkyScope } from "@linky-fit/linksync";
import React, { useEffect, useState } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useEvoluSettingsContext } from "../app/context/SystemSettingsContexts";
import { readRowOwnerId } from "../app/lib/rowOwnerId";
import {
  filterRowsToVisibleShards,
  scopeOfTable,
} from "../app/lib/shardTables";
import {
  loadEvoluCurrentData,
  loadEvoluHistoryData,
  type EvoluHistoryRow,
} from "../evolu";
import { formatEvoluRowCount } from "../utils/evoluRowCount";
import { formatBytes } from "../utils/formatting";
const ONE_MB = 1024 * 1024;
const USER_TABLES = [
  "contact",
  "conversation",
  "message",
  "reaction",
  "unknownSenderMessage",
  "cashuToken",
  "cashuProof",
  "cashuOperation",
  "nostrIdentity",
  "nostrMessage",
  "nostrReaction",
  "transaction",
  "recurringPayment",
  "keryxSubscription",
];
const SYSTEM_TABLES = ["ownerMeta", "shardPointer", "setting"];

type InScopeView = (tableName: string) => boolean;

const rowValue = (value: string) => (
  <Text variant="label" color="$colorMuted">
    {value}
  </Text>
);

function CurrentDataTables({ inScopeView }: { inScopeView: InScopeView }) {
  const { evoluShards } = useEvoluSettingsContext();
  const { t } = useAppShellCore();
  const [currentData, setCurrentData] = useState<Awaited<
    ReturnType<typeof loadEvoluCurrentData>
  > | null>(null);
  useEffect(() => {
    void loadEvoluCurrentData().then(setCurrentData);
  }, []);
  if (!currentData) return <LoadingState label={t("loading")} />;
  return Object.entries(currentData)
    .filter(([tableName]) => inScopeView(tableName))
    .map(([tableName, allRows]) => {
      const rows = filterRowsToVisibleShards(
        tableName,
        allRows,
        evoluShards,
        readRowOwnerId,
      );
      return (
        <Section key={tableName} title={tableName}>
          {rows.length > 0 ? (
            <EvoluCurrentTable tableName={tableName} rows={rows} />
          ) : (
            <EmptyState title={t("evoluNoDataYet")} />
          )}
        </Section>
      );
    });
}

function HistoryDataTable({ inScopeView }: { inScopeView: InScopeView }) {
  const { evoluShards } = useEvoluSettingsContext();
  const { t } = useAppShellCore();
  const [historyData, setHistoryData] = useState<EvoluHistoryRow[] | null>(
    null,
  );
  useEffect(() => {
    void loadEvoluHistoryData().then(setHistoryData);
  }, []);
  if (!historyData) return <LoadingState label={t("loading")} />;
  const rows = historyData.filter(
    (row) =>
      inScopeView(row.table) &&
      filterRowsToVisibleShards(row.table, [row], evoluShards, readRowOwnerId)
        .length === 1,
  );
  return rows.length > 0 ? (
    <EvoluHistoryTable rows={rows} t={t} />
  ) : (
    <EmptyState title={t("evoluNoDataYet")} />
  );
}

export function EvoluDataDetailPage(): React.ReactElement {
  const {
    clearDatabaseArmed,
    evoluDatabaseBytes,
    evoluErrorType,
    evoluHistoryCount,
    evoluShards,
    evoluTableCounts,
    evoluWipeStorageIsBusy,
    requestClearDatabase,
  } = useEvoluSettingsContext();
  const { t } = useAppShellCore();
  const [scopeView, setScopeView] = useState<LinkyScope | "all">("all");
  const inScopeView = React.useCallback(
    (tableName: string): boolean =>
      scopeView === "all" || scopeOfTable(tableName) === scopeView,
    [scopeView],
  );
  if (evoluDatabaseBytes === null) return <EmptyState title={t("unknown")} />;

  const percentage = Math.min((evoluDatabaseBytes / ONE_MB) * 100, 100);
  const rowCount = (rows: number | null) => formatEvoluRowCount(t, rows);
  const tableEntries = Object.entries(evoluTableCounts);
  const scopedEntries = tableEntries.filter(([name]) => inScopeView(name));
  const tablesOf = (names: readonly string[]) =>
    scopedEntries
      .filter(([name]) => names.includes(name))
      .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0));
  const userTableEntries = tablesOf(USER_TABLES);
  const systemTableEntries = tablesOf(SYSTEM_TABLES);
  const totalCurrentRows = scopedEntries.reduce<number | null>(
    (sum, [, count]) => (sum === null || count === null ? null : sum + count),
    scopedEntries.length ? 0 : null,
  );
  const totalRows =
    totalCurrentRows === null || evoluHistoryCount === null
      ? null
      : totalCurrentRows + evoluHistoryCount;
  const tableRow = ([tableName, rows]: [string, number | null]) => {
    const share =
      rows === null || totalRows === null
        ? null
        : totalRows > 0
          ? rows / totalRows
          : 0;
    return (
      <ListRow
        key={tableName}
        testID={tableName}
        title={tableName}
        trailing={rowValue(
          share === null
            ? rowCount(rows)
            : `${rowCount(rows)} (${Math.round(share * 100)}%) · ~${formatBytes(Math.round(share * evoluDatabaseBytes))}`,
        )}
      />
    );
  };

  return (
    <Stack gap="$lg">
      <ListRow
        title={t("evoluRawDbSize")}
        trailing={rowValue(
          t("evoluRawDbSizeOfLimit").replace(
            "{size}",
            formatBytes(evoluDatabaseBytes),
          ),
        )}
        testID="evoluRawDbSize"
      />

      <Stack gap="$xs">
        <Progress
          value={percentage}
          max={100}
          tone={
            percentage > 90 ? "danger" : percentage > 70 ? "warning" : "accent"
          }
          accessibilityLabel={t("evoluUsageOfLimit")}
        />
        <Text variant="caption" color="$colorMuted">
          {t("evoluUsageOfLimit").replace("{percent}", percentage.toFixed(1))}
        </Text>
      </Stack>

      <Button
        onPress={requestClearDatabase}
        disabled={evoluErrorType === "ProtocolQuotaError"}
        loading={evoluWipeStorageIsBusy}
        variant={clearDatabaseArmed ? "danger" : "secondary"}
      >
        {t("evoluClearDatabase")}
      </Button>

      <Section title={t("evoluRowCounts")}>
        <Row flexWrap="wrap" gap="$sm">
          <Chip
            label={t("all")}
            selected={scopeView === "all"}
            onPress={() => setScopeView("all")}
          />
          {evoluShards.map((shard) => (
            <Chip
              key={shard.scope}
              label={shard.scope}
              selected={scopeView === shard.scope}
              onPress={() => setScopeView(shard.scope)}
            />
          ))}
        </Row>

        {evoluShards.map((shard) => (
          <ListRow
            key={shard.scope}
            title={`${shard.scope} ${t("evoluShardIndex").toLowerCase()}`}
            trailing={rowValue(
              `${shard.index} (${shard.visibleOwnerIds.length} ${t("evoluShardVisibleCount").toLowerCase()})`,
            )}
            testID="evoluShardIndex"
          />
        ))}

        <ListRow
          title={t("evoluCurrentDataJson")}
          trailing={rowValue(rowCount(totalCurrentRows))}
          testID="evoluCurrentDataJson"
        />
        <ListRow
          title={t("evoluHistoryDataJson")}
          trailing={rowValue(rowCount(evoluHistoryCount))}
          testID="evoluHistoryDataJson"
        />
        <ListRow
          title={t("evoluTotalRows")}
          trailing={rowValue(rowCount(totalRows))}
          testID="evoluTotalRows"
        />
      </Section>

      <Disclosure title={t("evoluCurrentDataJson")}>
        <CurrentDataTables inScopeView={inScopeView} />
      </Disclosure>
      <Disclosure title={t("evoluHistoryDataJson")}>
        <HistoryDataTable inScopeView={inScopeView} />
      </Disclosure>

      <Section title={t("evoluUserTables")}>
        {userTableEntries.length === 0 ? (
          <EmptyState
            title={t(tableEntries.length === 0 ? "unknown" : "evoluNoDataYet")}
          />
        ) : (
          userTableEntries.map(tableRow)
        )}
      </Section>

      {systemTableEntries.length > 0 ? (
        <Section title={t("evoluSystemTables")}>
          {systemTableEntries.map(tableRow)}
        </Section>
      ) : null}

      <Text variant="caption" color="$colorMuted">
        {t("evoluSizeEstimateHint")}
      </Text>
    </Stack>
  );
}
