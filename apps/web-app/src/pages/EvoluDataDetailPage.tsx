import { EvoluHistoryTable } from "../components/EvoluHistoryTable";
import React, { useState } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useEvoluSettingsContext } from "../app/context/SystemSettingsContexts";
import { readRowOwnerId } from "../app/lib/rowOwnerId";
import {
  loadEvoluCurrentData,
  loadEvoluHistoryData,
  type EvoluHistoryRow,
} from "../evolu";
import {
  CONTACTS_OWNER_ROTATION_TRIGGER_WRITE_COUNT,
  MAX_CONTACTS_PER_OWNER,
} from "../utils/constants";
import { formatBytes } from "../utils/formatting";

const ONE_MB = 1024 * 1024;

export function EvoluDataDetailPage(): React.ReactElement {
  const {
    clearDatabaseArmed,
    evoluContactsOwnerEditCount,
    evoluContactsOwnerId,
    evoluContactsOwnerIndex,
    evoluContactsOwnerNewContactsCount,
    evoluContactsOwnerPointer,
    evoluDatabaseBytes,
    evoluErrorType,
    evoluHistoryCount,
    evoluTableCounts,
    evoluTransactionsOwnerId,
    evoluTransactionsOwnerIndex,
    evoluTransactionsOwnerPointer,
    evoluTransactionsVisibleOwnerIds,
    evoluWipeStorageIsBusy,
    requestClearDatabase,
  } = useEvoluSettingsContext();
  const { t } = useAppShellCore();
  const [ownerView, setOwnerView] = useState<
    "all" | "meta" | "contacts" | "transactions"
  >("all");
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
    "cashuToken",
    "nostrIdentity",
    "nostrMessage",
    "nostrReaction",
    "transaction",
  ];
  const systemTables = ["ownerMeta"];

  const tableEntries = Object.entries(evoluTableCounts);
  const scopedEntries = tableEntries.filter(([name]) => {
    if (ownerView === "meta") return name === "ownerMeta";
    if (ownerView === "contacts") return name === "contact";
    if (ownerView === "transactions") return name === "transaction";
    return true;
  });
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

  const currentDataEntries = React.useMemo(() => {
    const activeContactsOwnerId = (evoluContactsOwnerId ?? "").trim();
    const visibleTransactionsOwnerIds = new Set(
      [evoluTransactionsOwnerId, ...evoluTransactionsVisibleOwnerIds]
        .map((ownerId) => (ownerId ?? "").trim())
        .filter(Boolean),
    );

    return Object.entries(currentData)
      .filter(([tableName]) => {
        if (ownerView === "meta") return tableName === "ownerMeta";
        if (ownerView === "contacts") return tableName === "contact";
        if (ownerView === "transactions") return tableName === "transaction";
        return true;
      })
      .map(([tableName, rows]) => {
        if (tableName === "contact") {
          if (!activeContactsOwnerId) return [tableName, rows] as const;
          return [
            tableName,
            rows.filter((row) => readRowOwnerId(row) === activeContactsOwnerId),
          ] as const;
        }

        if (tableName === "transaction") {
          if (visibleTransactionsOwnerIds.size === 0) {
            return [tableName, rows] as const;
          }
          return [
            tableName,
            rows.filter((row) =>
              visibleTransactionsOwnerIds.has(readRowOwnerId(row)),
            ),
          ] as const;
        }

        return [tableName, rows] as const;
      });
  }, [
    currentData,
    evoluContactsOwnerId,
    evoluTransactionsOwnerId,
    evoluTransactionsVisibleOwnerIds,
    ownerView,
  ]);

  const visibleHistoryRows = React.useMemo(() => {
    const activeContactsOwnerId = (evoluContactsOwnerId ?? "").trim();
    const visibleTransactionsOwnerIds = new Set(
      [evoluTransactionsOwnerId, ...evoluTransactionsVisibleOwnerIds]
        .map((ownerId) => (ownerId ?? "").trim())
        .filter(Boolean),
    );

    if (ownerView === "meta") {
      return historyData.filter((row) => row.table === "ownerMeta");
    }

    if (ownerView === "contacts") {
      return historyData.filter(
        (row) =>
          row.table === "contact" &&
          readRowOwnerId(row) === activeContactsOwnerId,
      );
    }

    if (ownerView === "transactions") {
      return historyData.filter(
        (row) =>
          row.table === "transaction" &&
          visibleTransactionsOwnerIds.has(readRowOwnerId(row)),
      );
    }

    return historyData;
  }, [
    evoluContactsOwnerId,
    evoluTransactionsOwnerId,
    evoluTransactionsVisibleOwnerIds,
    historyData,
    ownerView,
  ]);

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
              className={ownerView === "all" ? "secondary" : "btn-wide"}
              onClick={() => setOwnerView("all")}
            >
              {t("all")}
            </button>
            <button
              type="button"
              className={ownerView === "meta" ? "secondary" : "btn-wide"}
              onClick={() => setOwnerView("meta")}
            >
              {t("evoluOwnerViewMeta")}
            </button>
            <button
              type="button"
              className={ownerView === "contacts" ? "secondary" : "btn-wide"}
              onClick={() => setOwnerView("contacts")}
            >
              {t("contactsTitle")}
            </button>
            <button
              type="button"
              className={
                ownerView === "transactions" ? "secondary" : "btn-wide"
              }
              onClick={() => setOwnerView("transactions")}
            >
              {t("transactionsTitle")}
            </button>
          </div>

          <div className="settings-row">
            <div className="settings-left">
              <span className="settings-label">{t("evoluContactsOwner")}</span>
            </div>
            <div className="settings-right">
              <span className="muted">{evoluContactsOwnerPointer}</span>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-left">
              <span className="settings-label">
                {t("evoluContactsOwnerIndex")}
              </span>
            </div>
            <div className="settings-right">
              <span className="muted">{evoluContactsOwnerIndex}</span>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-left">
              <span className="settings-label">
                {t("evoluContactsOwnerNewContacts")}
              </span>
            </div>
            <div className="settings-right">
              <span className="muted">
                {evoluContactsOwnerNewContactsCount} / {MAX_CONTACTS_PER_OWNER}
              </span>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-left">
              <span className="settings-label">
                {t("evoluContactsOwnerEdits")}
              </span>
            </div>
            <div className="settings-right">
              <span className="muted">
                {evoluContactsOwnerEditCount} /{" "}
                {CONTACTS_OWNER_ROTATION_TRIGGER_WRITE_COUNT}
              </span>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-left">
              <span className="settings-label">
                {t("evoluTransactionsOwner")}
              </span>
            </div>
            <div className="settings-right">
              <span className="muted">{evoluTransactionsOwnerPointer}</span>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-left">
              <span className="settings-label">
                {t("evoluTransactionsOwnerIndex")}
              </span>
            </div>
            <div className="settings-right">
              <span className="muted">{evoluTransactionsOwnerIndex}</span>
            </div>
          </div>

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
                              {Object.values(row).map((val, vidx) => (
                                <td key={vidx} className="evolu-data-cell">
                                  {typeof val === "object" && val !== null
                                    ? JSON.stringify(val).slice(0, 50)
                                    : String(val ?? "").slice(0, 50)}
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
