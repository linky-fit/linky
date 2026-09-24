import { EvoluHistoryTable } from "../components/EvoluHistoryTable";
import type { LinkyScope } from "@linky/linksync";
import React, { useState } from "react";
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
import { formatEvoluDebugValue } from "../utils/evoluDebugValue";
import { formatBytes } from "../utils/formatting";

const ONE_MB = 1024 * 1024;

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
  const [showHistoryData, setShowHistoryData] = useState(false);
  const [showCurrentData, setShowCurrentData] = useState(false);
  const [historyData, setHistoryData] = useState<EvoluHistoryRow[]>([]);
  const [currentData, setCurrentData] = useState<
    Awaited<ReturnType<typeof loadEvoluCurrentData>>
  >({});
  const [isLoading, setIsLoading] = useState(false);

  const rawDbBytes = evoluDatabaseBytes ?? 0;
  const percentage = Math.min((rawDbBytes / ONE_MB) * 100, 100);

  // Separate tables into user data and system tables
  const userTables = [
    "contact",
    "conversation",
    "message",
    "reaction",
    "cashuToken",
    "cashuProof",
    "cashuOperation",
    "nostrIdentity",
    "nostrMessage",
    "nostrReaction",
    "transaction",
    "recurringPayment",
  ];
  const systemTables = ["ownerMeta", "shardPointer", "setting"];

  const tableEntries = Object.entries(evoluTableCounts);
  const scopedEntries = tableEntries.filter(([name]) => inScopeView(name));
  const userTableEntries = scopedEntries
    .filter(([name]) => userTables.includes(name))
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0));
  const systemTableEntries = scopedEntries
    .filter(([name]) => systemTables.includes(name))
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0));

  const totalCurrentRows = scopedEntries.reduce<number | null>(
    (sum, [, count]) => (sum === null || count === null ? null : sum + count),
    scopedEntries.length ? 0 : null,
  );
  const historyRows = evoluHistoryCount;
  const totalRows =
    totalCurrentRows === null || historyRows === null
      ? null
      : totalCurrentRows + historyRows;

  // Calculate row distribution percentages
  const calculatePercentage = (rows: number | null) => {
    if (rows === null || totalRows === null) return null;
    if (totalRows === 0) return 0;
    return Math.round((rows / totalRows) * 100);
  };

  const handleShowHistory = async () => {
    if (!showHistoryData && historyData.length === 0) {
      setIsLoading(true);
      const data = await loadEvoluHistoryData();
      setHistoryData(data);
      setIsLoading(false);
    }
    setShowHistoryData(!showHistoryData);
  };

  const handleShowCurrent = async () => {
    if (!showCurrentData && Object.keys(currentData).length === 0) {
      setIsLoading(true);
      const data = await loadEvoluCurrentData();
      setCurrentData(data);
      setIsLoading(false);
    }
    setShowCurrentData(!showCurrentData);
  };

  const currentDataEntries = React.useMemo(
    () =>
      Object.entries(currentData)
        .filter(([tableName]) => inScopeView(tableName))
        .map(
          ([tableName, rows]) =>
            [
              tableName,
              filterRowsToVisibleShards(
                tableName,
                rows,
                evoluShards,
                readRowOwnerId,
              ),
            ] as const,
        ),
    [currentData, evoluShards, inScopeView],
  );

  const visibleHistoryRows = React.useMemo(
    () =>
      historyData.filter(
        (row) =>
          inScopeView(row.table) &&
          filterRowsToVisibleShards(
            row.table,
            [row],
            evoluShards,
            readRowOwnerId,
          ).length === 1,
      ),
    [evoluShards, historyData, inScopeView],
  );

  return (
    <section className="panel">
      {evoluDatabaseBytes !== null ? (
        <>
          <div className="settings-row">
            <div className="settings-left">
              <span className="settings-label">{t("evoluRawDbSize")}</span>
            </div>
            <div className="settings-right">
              <span className="muted">{formatBytes(rawDbBytes)} / 1 MiB</span>
            </div>
          </div>

          {/* Progress bar showing usage of 1MB limit */}
          <div className="evolu-usage-summary">
            <progress
              className={`evolu-usage-progress ${percentage > 90 ? "is-error" : percentage > 70 ? "is-warning" : "is-success"}`}
              value={percentage}
              max={100}
            />

            <div className="muted evolu-usage-caption">
              {t("evoluUsageOfLimit").replace(
                "{percent}",
                percentage.toFixed(1),
              )}
            </div>
          </div>

          <div className="settings-row evolu-data-section">
            <button
              type="button"
              className={
                clearDatabaseArmed
                  ? "btn-wide secondary danger-armed"
                  : "btn-wide secondary"
              }
              onClick={requestClearDatabase}
              disabled={
                evoluWipeStorageIsBusy ||
                evoluErrorType === "ProtocolQuotaError"
              }
            >
              {t("evoluClearDatabase")}
            </button>
          </div>

          <h3 className="evolu-data-heading">{t("evoluRowCounts")}</h3>

          <div className="settings-row evolu-owner-tabs">
            <button
              type="button"
              className={scopeView === "all" ? "secondary" : "btn-wide"}
              onClick={() => setScopeView("all")}
            >
              {t("all")}
            </button>
            {evoluShards.map((shard) => (
              <button
                key={shard.scope}
                type="button"
                className={scopeView === shard.scope ? "secondary" : "btn-wide"}
                onClick={() => setScopeView(shard.scope)}
              >
                {shard.scope}
              </button>
            ))}
          </div>

          {evoluShards.map((shard) => (
            <div key={shard.scope} className="settings-row">
              <div className="settings-left">
                <span className="settings-label">
                  {shard.scope} {t("evoluShardIndex").toLowerCase()}
                </span>
              </div>
              <div className="settings-right">
                <span className="muted">
                  {shard.index} ({shard.visibleOwnerIds.length}{" "}
                  {t("evoluShardVisibleCount").toLowerCase()})
                </span>
              </div>
            </div>
          ))}

          <div className="settings-row">
            <div className="settings-left">
              <span className="settings-label">
                {t("evoluCurrentDataJson")}
              </span>
            </div>
            <div className="settings-right">
              <span className="muted">
                {totalCurrentRows === null
                  ? t("unknown")
                  : `${totalCurrentRows} rows`}
              </span>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-left">
              <span className="settings-label">
                {t("evoluHistoryDataJson")}
              </span>
            </div>
            <div className="settings-right">
              <span className="muted">
                {historyRows === null ? t("unknown") : `${historyRows} rows`}
              </span>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-left">
              <span className="settings-label">{t("evoluTotalRows")}</span>
            </div>
            <div className="settings-right">
              <span className="muted">
                {totalRows === null ? t("unknown") : `${totalRows} rows`}
              </span>
            </div>
          </div>

          {/* Buttons to view data */}
          <div className="settings-row evolu-data-actions">
            <button
              type="button"
              className="secondary"
              onClick={handleShowCurrent}
              disabled={isLoading}
            >
              {showCurrentData
                ? t("evoluHideCurrentData")
                : t("evoluShowCurrentData")}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={handleShowHistory}
              disabled={isLoading}
            >
              {showHistoryData
                ? t("evoluHideHistoryData")
                : t("evoluShowHistoryData")}
            </button>
          </div>

          {isLoading && <p className="muted section-note">{t("loading")}...</p>}

          {/* Current Data Table View */}
          {showCurrentData && (
            <div className="evolu-data-section">
              <h4>{t("evoluCurrentDataJson")}</h4>
              <div className="evolu-data-preview-scroll">
                {currentDataEntries.map(([tableName, rows]) => (
                  <div key={tableName} className="evolu-data-table-group">
                    <h5 className="evolu-data-table-heading">
                      {tableName} ({rows.length} rows)
                    </h5>
                    {rows.length > 0 ? (
                      <table className="evolu-data-table">
                        <thead>
                          <tr className="evolu-data-header-row">
                            {Object.keys(rows[0]).map((key) => (
                              <th
                                key={key}
                                className="evolu-data-bordered-heading"
                              >
                                {key}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row, idx) => (
                            <tr key={idx}>
                              {Object.entries(row).map(([key, val], vidx) => (
                                <td key={vidx} className="evolu-data-cell">
                                  {formatEvoluDebugValue(
                                    tableName,
                                    key,
                                    val,
                                  ).slice(0, 50)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="muted">{t("evoluNoDataYet")}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* History Data Table View - All individual records */}
          {showHistoryData && (
            <div className="evolu-data-section">
              <h4>{t("evoluHistoryDataJson")}</h4>
              <div className="evolu-data-preview-scroll">
                {visibleHistoryRows.length > 0 ? (
                  <EvoluHistoryTable rows={visibleHistoryRows} t={t} />
                ) : (
                  <p className="muted">{t("evoluNoDataYet")}</p>
                )}
              </div>
            </div>
          )}

          <h3 className="evolu-data-heading">{t("evoluUserTables")}</h3>

          {userTableEntries.length === 0 ? (
            <p className="muted">
              {t(tableEntries.length === 0 ? "unknown" : "evoluNoDataYet")}
            </p>
          ) : (
            userTableEntries.map(([tableName, count]) => {
              const rows = count;
              const percentage = calculatePercentage(rows);
              const estimatedTableBytes =
                rows === null || totalRows === null
                  ? null
                  : totalRows > 0
                    ? Math.round((rows / totalRows) * rawDbBytes)
                    : 0;

              return (
                <div key={tableName} className="settings-row">
                  <div className="settings-left">
                    <span className="settings-label">{tableName}</span>
                  </div>
                  <div className="settings-right">
                    <span className="muted">
                      {rows === null ? t("unknown") : `${rows} rows`}
                      {percentage === null ? "" : ` (${percentage}%)`}
                    </span>
                    <span className="muted evolu-data-count">
                      {estimatedTableBytes === null
                        ? ""
                        : `~${formatBytes(estimatedTableBytes)}`}
                    </span>
                  </div>
                </div>
              );
            })
          )}

          {systemTableEntries.length > 0 && (
            <>
              <h3 className="evolu-data-heading">{t("evoluSystemTables")}</h3>
              {systemTableEntries.map(([tableName, count]) => {
                const rows = count;
                const percentage = calculatePercentage(rows);
                const estimatedTableBytes =
                  rows === null || totalRows === null
                    ? null
                    : totalRows > 0
                      ? Math.round((rows / totalRows) * rawDbBytes)
                      : 0;

                return (
                  <div key={tableName} className="settings-row">
                    <div className="settings-left">
                      <span className="settings-label">{tableName}</span>
                    </div>
                    <div className="settings-right">
                      <span className="muted">
                        {rows === null ? t("unknown") : `${rows} rows`}
                        {percentage === null ? "" : ` (${percentage}%)`}
                      </span>
                      <span className="muted evolu-data-count">
                        {estimatedTableBytes === null
                          ? ""
                          : `~${formatBytes(estimatedTableBytes)}`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          <p className="muted evolu-data-footnote">
            {t("evoluSizeEstimateHint")}
          </p>
        </>
      ) : (
        <p className="muted">{t("unknown")}</p>
      )}
    </section>
  );
}
