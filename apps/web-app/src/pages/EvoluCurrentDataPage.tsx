import React, { useEffect, useState } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useEvoluSettingsContext } from "../app/context/SystemSettingsContexts";
import { readRowOwnerId } from "../app/lib/rowOwnerId";
import { loadEvoluCurrentData } from "../evolu";
import { formatEvoluDebugValue } from "../utils/evoluDebugValue";
import { MESSAGES_OWNER_ROTATION_TRIGGER_WRITE_COUNT } from "../utils/constants";

interface EvoluDataSectionConfig {
  editsUntilRotation: number | null;
  label: string;
  onRotate: (() => Promise<void>) | null;
  ownerIndex: number | null;
  rotateIsBusy: boolean;
  rotateLabel: string | null;
  rotatingLabel: string | null;
  rotationLimit: number | null;
}

function isTrackedTable(tableName: string): boolean {
  return (
    tableName === "contact" ||
    tableName === "cashuProof" ||
    tableName === "cashuOperation" ||
    tableName === "nostrMessage" ||
    tableName === "nostrReaction" ||
    tableName === "transaction"
  );
}

export function EvoluCurrentDataPage(): React.ReactElement {
  const {
    evoluCashuOwnerIndex,
    evoluCashuVisibleOwnerIds,
    evoluContactsOwnerIndex,
    evoluContactsVisibleOwnerIds,
    evoluMessagesOwnerEditsUntilRotation,
    evoluMessagesOwnerId,
    evoluMessagesOwnerIndex,
    evoluMessagesVisibleOwnerIds,
    evoluTransactionsOwnerIndex,
    evoluTransactionsVisibleOwnerIds,
    requestManualRotateCashuOwner,
    requestManualRotateContactsOwner,
    requestManualRotateMessagesOwner,
    requestManualRotateTransactionsOwner,
    rotateCashuOwnerIsBusy,
    rotateContactsOwnerIsBusy,
    rotateMessagesOwnerIsBusy,
    rotateTransactionsOwnerIsBusy,
  } = useEvoluSettingsContext();
  const { t } = useAppShellCore();
  const previewRowCount = 2;
  const [currentData, setCurrentData] = useState<
    Awaited<ReturnType<typeof loadEvoluCurrentData>>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>(
    {},
  );

  useEffect(() => {
    loadEvoluCurrentData().then((data) => {
      setCurrentData(data);
      setIsLoading(false);
    });
  }, []);

  const filteredCurrentData = React.useMemo(() => {
    const visibleContactOwnerIds = new Set<string>(
      evoluContactsVisibleOwnerIds,
    );
    const visibleCashuOwnerIds = new Set<string>(evoluCashuVisibleOwnerIds);
    const visibleMessageOwnerIds = new Set(
      [evoluMessagesOwnerId, ...evoluMessagesVisibleOwnerIds]
        .map((ownerId) => (ownerId ?? "").trim())
        .filter(Boolean),
    );
    const visibleTransactionOwnerIds = new Set<string>(
      evoluTransactionsVisibleOwnerIds,
    );

    return Object.fromEntries(
      Object.entries(currentData).map(
        ([tableName, rows]): [string, typeof rows] => {
          if (!isTrackedTable(tableName)) {
            return [tableName, rows];
          }
          if (tableName === "contact") {
            if (visibleContactOwnerIds.size === 0) return [tableName, []];
            return [
              tableName,
              rows.filter((row) =>
                visibleContactOwnerIds.has(readRowOwnerId(row)),
              ),
            ];
          }
          if (tableName === "cashuProof" || tableName === "cashuOperation") {
            if (visibleCashuOwnerIds.size === 0) return [tableName, []];
            return [
              tableName,
              rows.filter((row) =>
                visibleCashuOwnerIds.has(readRowOwnerId(row)),
              ),
            ];
          }
          if (tableName === "transaction") {
            if (visibleTransactionOwnerIds.size === 0) return [tableName, []];
            return [
              tableName,
              rows.filter((row) =>
                visibleTransactionOwnerIds.has(readRowOwnerId(row)),
              ),
            ];
          }
          if (visibleMessageOwnerIds.size === 0) return [tableName, []];
          return [
            tableName,
            rows.filter((row) =>
              visibleMessageOwnerIds.has(readRowOwnerId(row)),
            ),
          ];
        },
      ),
    );
  }, [
    currentData,
    evoluCashuVisibleOwnerIds,
    evoluContactsVisibleOwnerIds,
    evoluMessagesOwnerId,
    evoluMessagesVisibleOwnerIds,
    evoluTransactionsVisibleOwnerIds,
  ]);

  const trackedTableConfigs = React.useMemo(() => {
    // Both cashu tables share one shard; the inventory carries the rotate
    // button, the other only reports the shared index. The store rotates by
    // bytes or mutations on its own, so there is no edit counter to show.
    const cashuConfig = (
      label: string,
      withRotate: boolean,
    ): EvoluDataSectionConfig => ({
      label,
      ownerIndex: evoluCashuOwnerIndex,
      editsUntilRotation: null,
      rotationLimit: null,
      onRotate: withRotate ? requestManualRotateCashuOwner : null,
      rotateLabel: withRotate ? t("evoluCashuOwnerRotate") : null,
      rotateIsBusy: rotateCashuOwnerIsBusy,
      rotatingLabel: withRotate ? t("evoluCashuOwnerRotating") : null,
    });
    const messageConfig = (label: string): EvoluDataSectionConfig => ({
      label,
      ownerIndex: evoluMessagesOwnerIndex,
      editsUntilRotation: evoluMessagesOwnerEditsUntilRotation,
      rotationLimit: MESSAGES_OWNER_ROTATION_TRIGGER_WRITE_COUNT,
      onRotate: requestManualRotateMessagesOwner,
      rotateLabel: t("evoluMessagesOwnerRotate"),
      rotateIsBusy: rotateMessagesOwnerIsBusy,
      rotatingLabel: t("evoluMessagesOwnerRotating"),
    });

    return new Map<string, EvoluDataSectionConfig>([
      // Contacts live on shards like transactions; the button also rotates
      // the cashu shard because the two were one owner once.
      [
        "contact",
        {
          label: t("contactsTitle"),
          ownerIndex: evoluContactsOwnerIndex,
          editsUntilRotation: null,
          rotationLimit: null,
          onRotate: requestManualRotateContactsOwner,
          rotateLabel: t("evoluContactsCashuOwnerRotate"),
          rotateIsBusy: rotateContactsOwnerIsBusy,
          rotatingLabel: t("evoluContactsCashuOwnerRotating"),
        },
      ],
      ["cashuProof", cashuConfig(t("cashuProofsTable"), true)],
      ["cashuOperation", cashuConfig(t("cashuOperationsTable"), false)],
      ["nostrMessage", messageConfig(t("messagesTitle"))],
      ["nostrReaction", messageConfig(t("reactionsTitle"))],
      // Transactions live on shards; the store rotates them by bytes or
      // mutations on its own, so there is no edit counter to show.
      [
        "transaction",
        {
          label: t("transactionsTitle"),
          ownerIndex: evoluTransactionsOwnerIndex,
          editsUntilRotation: null,
          rotationLimit: null,
          onRotate: requestManualRotateTransactionsOwner,
          rotateLabel: t("evoluTransactionsOwnerRotate"),
          rotateIsBusy: rotateTransactionsOwnerIsBusy,
          rotatingLabel: t("evoluTransactionsOwnerRotating"),
        },
      ],
    ]);
  }, [
    evoluCashuOwnerIndex,
    evoluContactsOwnerIndex,
    evoluMessagesOwnerEditsUntilRotation,
    evoluMessagesOwnerIndex,
    evoluTransactionsOwnerIndex,
    requestManualRotateCashuOwner,
    requestManualRotateContactsOwner,
    requestManualRotateMessagesOwner,
    requestManualRotateTransactionsOwner,
    rotateCashuOwnerIsBusy,
    rotateContactsOwnerIsBusy,
    rotateMessagesOwnerIsBusy,
    rotateTransactionsOwnerIsBusy,
    t,
  ]);

  const dataSections = React.useMemo(
    () =>
      Object.entries(filteredCurrentData)
        .filter(
          ([tableName, rows]) => isTrackedTable(tableName) || rows.length > 0,
        )
        .map(([tableName, rows]) => {
          const config = trackedTableConfigs.get(tableName) ?? {
            label: tableName,
            ownerIndex: null,
            editsUntilRotation: null,
            rotationLimit: null,
            onRotate: null,
            rotateLabel: null,
            rotateIsBusy: false,
            rotatingLabel: null,
          };
          return { tableName, rows, ...config };
        }),
    [filteredCurrentData, trackedTableConfigs],
  );

  if (isLoading) {
    return (
      <section className="panel panel-plain page-loading-panel">
        <p className="muted">{t("loading")}...</p>
      </section>
    );
  }

  return (
    <section className="panel panel-layout">
      <div className="evolu-data-scroll">
        {dataSections.map(
          ({
            tableName,
            rows,
            label,
            ownerIndex,
            editsUntilRotation,
            rotationLimit,
            onRotate,
            rotateLabel,
            rotateIsBusy,
            rotatingLabel,
          }) => {
            const usedEdits =
              editsUntilRotation !== null && rotationLimit !== null
                ? Math.max(
                    0,
                    Math.min(rotationLimit, rotationLimit - editsUntilRotation),
                  )
                : null;

            const progressPercent =
              usedEdits !== null && rotationLimit !== null
                ? Math.min(100, Math.max(0, (usedEdits / rotationLimit) * 100))
                : 0;
            const isExpanded = expandedTables[tableName] === true;
            const visibleRows = isExpanded
              ? rows
              : rows.slice(0, previewRowCount);
            const hiddenRowsCount = Math.max(
              0,
              rows.length - visibleRows.length,
            );
            const toggleExpanded = () => {
              setExpandedTables((current) => ({
                ...current,
                [tableName]: !current[tableName],
              }));
            };

            return (
              <div key={tableName} className="evolu-data-card">
                <div className="evolu-data-card-header">
                  <div
                    className={`evolu-data-title-row${ownerIndex !== null || editsUntilRotation !== null ? " has-owner-summary" : ""}`}
                  >
                    <h3 className="unspaced">{label}</h3>

                    {onRotate && rotateLabel && rotatingLabel && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          if (rotateIsBusy) return;
                          void onRotate();
                        }}
                        disabled={rotateIsBusy}
                      >
                        {rotateIsBusy ? rotatingLabel : rotateLabel}
                      </button>
                    )}
                  </div>

                  {(ownerIndex !== null || editsUntilRotation !== null) && (
                    <div className="evolu-owner-summary-grid">
                      <div className="evolu-owner-summary-stack">
                        <div className="evolu-owner-stat">
                          <div className="evolu-owner-stat-line">
                            <span className="muted">Rows</span>
                            <span className="evolu-owner-stat-value">
                              {rows.length}
                            </span>
                          </div>
                        </div>

                        {ownerIndex !== null && (
                          <div className="evolu-owner-stat">
                            <div className="evolu-owner-stat-line">
                              <span className="muted">
                                {t("evoluOwnerIndex")}
                              </span>
                              <span className="evolu-owner-stat-value">
                                {ownerIndex}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      {editsUntilRotation !== null &&
                        rotationLimit !== null && (
                          <div className="evolu-owner-stat">
                            <div className="evolu-owner-progress-label">
                              <span className="muted">
                                {t("evoluEditsUntilRotation")}
                              </span>
                              <span className="evolu-owner-stat-value">
                                {editsUntilRotation}/{rotationLimit}
                              </span>
                            </div>

                            <progress
                              className={`evolu-usage-progress ${editsUntilRotation <= Math.round(rotationLimit * 0.1) ? "is-error" : editsUntilRotation <= Math.round(rotationLimit * 0.3) ? "is-warning" : "is-success"}`}
                              value={progressPercent}
                              max={100}
                            />
                          </div>
                        )}
                    </div>
                  )}
                </div>

                <div className="evolu-data-card-body">
                  {rows.length > 0 ? (
                    <>
                      <table className="evolu-data-table">
                        <thead>
                          <tr className="evolu-data-row">
                            {Object.keys(rows[0])
                              .filter((key) => key !== "createdAt")
                              .map((key) => (
                                <th
                                  key={key}
                                  className="evolu-data-heading-cell"
                                >
                                  {key}
                                </th>
                              ))}
                          </tr>
                        </thead>
                        <tbody>
                          {visibleRows.map((row, idx) => (
                            <tr key={idx}>
                              {Object.entries(row)
                                .filter(([key]) => key !== "createdAt")
                                .map(([key, val], valueIdx) => {
                                  const fullValue = formatEvoluDebugValue(
                                    tableName,
                                    key,
                                    val,
                                  );
                                  const previewValue = fullValue.slice(0, 50);

                                  return (
                                    <td
                                      key={valueIdx}
                                      className="evolu-data-cell"
                                    >
                                      {previewValue}
                                    </td>
                                  );
                                })}
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {(rows.length > previewRowCount || isExpanded) && (
                        <div className="evolu-data-pagination">
                          <span className="muted">
                            {isExpanded
                              ? t("evoluShowingAllRows")
                              : t("evoluShowingPreviewRows").replace(
                                  "{count}",
                                  String(visibleRows.length),
                                )}
                          </span>
                          <button
                            type="button"
                            className="secondary"
                            onClick={toggleExpanded}
                          >
                            {isExpanded
                              ? t("evoluHideSectionDetail")
                              : t("evoluShowSectionDetail").replace(
                                  "{count}",
                                  String(hiddenRowsCount),
                                )}
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="muted unspaced">{t("evoluNoDataYet")}</p>
                  )}
                </div>
              </div>
            );
          },
        )}
      </div>
    </section>
  );
}
