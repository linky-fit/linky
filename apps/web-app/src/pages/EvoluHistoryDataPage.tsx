import { EvoluHistoryTable } from "../components/EvoluHistoryTable";
import { base64 } from "@scure/base";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useEvoluSettingsContext } from "../app/context/SystemSettingsContexts";
import { loadEvoluHistoryData, type EvoluHistoryRow } from "../evolu";
import { decodeBase64Url } from "../utils/base64";

const BATCH_SIZE = 50;

export function EvoluHistoryDataPage(): React.ReactElement {
  const { evoluHistoryAllowedOwnerIds } = useEvoluSettingsContext();
  const { t } = useAppShellCore();
  const [historyData, setHistoryData] = useState<EvoluHistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  const normalizeOwnerId = useCallback((value: string): string => {
    const bytes = decodeBase64Url(value);
    return bytes?.length ? base64.encode(bytes) : value.trim();
  }, []);

  const allowedOwnerIds = useMemo(() => {
    const values = evoluHistoryAllowedOwnerIds
      .map((ownerId) => ownerId.trim())
      .filter(Boolean);

    const out = new Set<string>();
    for (const value of values) {
      out.add(value);
      out.add(normalizeOwnerId(value));
    }
    return out;
  }, [evoluHistoryAllowedOwnerIds, normalizeOwnerId]);

  const readRowOwnerId = useCallback(
    (row: EvoluHistoryRow): string => {
      const ownerId = row.ownerId;
      if (typeof ownerId !== "string") return "";
      const normalized = normalizeOwnerId(ownerId);
      if (normalized) return normalized;
      return ownerId.trim();
    },
    [normalizeOwnerId],
  );

  useEffect(() => {
    loadEvoluHistoryData(BATCH_SIZE, 0).then((data) => {
      setHistoryData(data);
      setIsLoading(false);
      setHasMore(data.length === BATCH_SIZE);
    });
  }, []);

  const visibleHistoryData = useMemo(() => {
    if (allowedOwnerIds.size === 0) return [];
    return historyData.filter((row) =>
      allowedOwnerIds.has(readRowOwnerId(row)),
    );
  }, [allowedOwnerIds, historyData, readRowOwnerId]);

  const tableNames = useMemo(() => {
    const tables = new Set<string>();
    visibleHistoryData.forEach((row) => {
      if (row.table) tables.add(row.table);
    });
    return Array.from(tables).sort();
  }, [visibleHistoryData]);

  const filteredData = useMemo(() => {
    if (!selectedTable) return visibleHistoryData;
    return visibleHistoryData.filter((row) => row.table === selectedTable);
  }, [selectedTable, visibleHistoryData]);

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    const newOffset = offset + BATCH_SIZE;

    try {
      const newData = await loadEvoluHistoryData(BATCH_SIZE, newOffset);

      if (newData.length > 0) {
        setHistoryData((prev) => [...prev, ...newData]);
        setOffset(newOffset);
        setHasMore(newData.length === BATCH_SIZE);
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error("Failed to load more history:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, offset]);

  if (isLoading) {
    return (
      <section className="panel panel-plain page-loading-panel">
        <p className="muted">{t("loading")}...</p>
      </section>
    );
  }

  return (
    <section className="panel panel-layout">
      {tableNames.length > 0 && (
        <nav
          className="group-filter-bar evolu-data-table-group"
          aria-label={t("filterByTable")}
        >
          <div className="group-filter-inner">
            <button
              type="button"
              className={
                selectedTable === null
                  ? "group-filter-btn is-active"
                  : "group-filter-btn"
              }
              onClick={() => setSelectedTable(null)}
            >
              {t("all")}
            </button>
            {tableNames.map((tableName) => (
              <button
                key={tableName}
                type="button"
                className={
                  selectedTable === tableName
                    ? "group-filter-btn is-active"
                    : "group-filter-btn"
                }
                onClick={() => setSelectedTable(tableName)}
                title={tableName}
              >
                {tableName}
              </button>
            ))}
          </div>
        </nav>
      )}

      <div className="evolu-data-scroll">
        {filteredData.length > 0 ? (
          <EvoluHistoryTable rows={filteredData} t={t} />
        ) : (
          <p className="muted">{t("evoluNoDataYet")}</p>
        )}

        {hasMore && (
          <div className="evolu-data-load-more">
            <button
              onClick={handleLoadMore}
              disabled={isLoadingMore}
              className="secondary"
            >
              {isLoadingMore ? t("loadingMore") : t("loadMore")}
            </button>
          </div>
        )}

        {!hasMore && historyData.length > 0 && (
          <p className="muted evolu-data-load-more">{t("allRecordsLoaded")}</p>
        )}
      </div>
    </section>
  );
}
