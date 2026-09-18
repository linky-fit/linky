import React, { useEffect, useState } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useEvoluSettingsContext } from "../app/context/SystemSettingsContexts";
import { readRowOwnerId } from "../app/lib/rowOwnerId";
import {
  filterRowsToVisibleShards,
  scopeOfTable,
  shortOwnerId,
} from "../app/lib/shardTables";
import { loadEvoluCurrentData } from "../evolu";
import { formatEvoluDebugValue } from "../utils/evoluDebugValue";

export function EvoluCurrentDataPage(): React.ReactElement {
  const { evoluShards, requestRotateShard, rotatingShardScope } =
    useEvoluSettingsContext();
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

  const dataSections = React.useMemo(
    () =>
      Object.entries(currentData)
        .map(([tableName, rows]) => ({
          tableName,
          scope: scopeOfTable(tableName),
          rows: filterRowsToVisibleShards(
            tableName,
            rows,
            evoluShards,
            readRowOwnerId,
          ),
        }))
        .filter(({ scope, rows }) => scope !== null || rows.length > 0),
    [currentData, evoluShards],
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
        <div className="evolu-data-card">
          <div className="evolu-data-card-header">
            <div className="evolu-data-title-row has-owner-summary">
              <h3 className="unspaced">{t("evoluShards")}</h3>
            </div>
            <div className="evolu-owner-summary-grid">
              {evoluShards.map((shard) => (
                <div key={shard.scope} className="evolu-owner-stat">
                  <div className="evolu-owner-stat-line">
                    <span className="evolu-owner-stat-value">
                      {shard.scope}
                    </span>
                    {shard.rotates ? (
                      <button
                        type="button"
                        className="secondary"
                        disabled={rotatingShardScope !== null}
                        onClick={() => {
                          if (rotatingShardScope !== null) return;
                          void requestRotateShard(shard.scope);
                        }}
                      >
                        {t(
                          rotatingShardScope === shard.scope
                            ? "evoluShardRotating"
                            : "evoluShardRotate",
                        ).replace("{scope}", shard.scope)}
                      </button>
                    ) : (
                      <span className="muted">{t("evoluShardFixed")}</span>
                    )}
                  </div>
                  <div className="evolu-owner-stat-line">
                    <span className="muted">{t("evoluShardIndex")}</span>
                    <span>{shard.index}</span>
                  </div>
                  <div className="evolu-owner-stat-line">
                    <span className="muted">{t("evoluShardVisibleCount")}</span>
                    <span>{shard.visibleOwnerIds.length}</span>
                  </div>
                  <div className="evolu-owner-stat-line">
                    <span className="muted">{t("evoluShardOwner")}</span>
                    <span title={shard.ownerId}>
                      {shortOwnerId(shard.ownerId)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {dataSections.map(({ tableName, scope, rows }) => {
          const shard = evoluShards.find((entry) => entry.scope === scope);
          const isExpanded = expandedTables[tableName] === true;
          const visibleRows = isExpanded
            ? rows
            : rows.slice(0, previewRowCount);
          const hiddenRowsCount = Math.max(0, rows.length - visibleRows.length);
          const toggleExpanded = () => {
            setExpandedTables((current) => ({
              ...current,
              [tableName]: !current[tableName],
            }));
          };

          return (
            <div key={tableName} className="evolu-data-card">
              <div className="evolu-data-card-header">
                <div className="evolu-data-title-row has-owner-summary">
                  <h3 className="unspaced">{tableName}</h3>
                  {shard && (
                    <span className="muted">
                      {shard.scope} / {shard.index}
                    </span>
                  )}
                </div>

                <div className="evolu-owner-summary-grid">
                  <div className="evolu-owner-stat">
                    <div className="evolu-owner-stat-line">
                      <span className="muted">Rows</span>
                      <span className="evolu-owner-stat-value">
                        {rows.length}
                      </span>
                    </div>
                  </div>
                </div>
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
                              <th key={key} className="evolu-data-heading-cell">
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
                              .map(([key, val], valueIdx) => (
                                <td key={valueIdx} className="evolu-data-cell">
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
        })}
      </div>
    </section>
  );
}
