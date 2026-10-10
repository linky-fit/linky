import {
  Button,
  Chip,
  EmptyState,
  LoadingState,
  Row,
  Stack,
  Text,
} from "@linky-fit/ui";
import { EvoluHistoryTable } from "../components/EvoluHistoryTable";
import { base64 } from "@scure/base";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useEvoluSettingsContext } from "../app/context/SystemSettingsContexts";
import {
  loadEvoluHistoryData,
  useLinkyEvolu,
  type EvoluHistoryRow,
} from "../evolu";
import { decodeBase64Url } from "../utils/base64";
const BATCH_SIZE = 50;
export function EvoluHistoryDataPage(): React.ReactElement {
  const { evoluSyncOwnerIds } = useEvoluSettingsContext();
  const { t } = useAppShellCore();
  const evolu = useLinkyEvolu();
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
    const values = evoluSyncOwnerIds
      .map((ownerId) => ownerId.trim())
      .filter(Boolean);
    const out = new Set<string>();
    for (const value of values) {
      out.add(value);
      out.add(normalizeOwnerId(value));
    }
    return out;
  }, [evoluSyncOwnerIds, normalizeOwnerId]);
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
    loadEvoluHistoryData(evolu, BATCH_SIZE, 0).then((data) => {
      setHistoryData(data);
      setIsLoading(false);
      setHasMore(data.length === BATCH_SIZE);
    });
  }, [evolu]);
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
      const newData = await loadEvoluHistoryData(evolu, BATCH_SIZE, newOffset);
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
  }, [evolu, isLoadingMore, hasMore, offset]);
  if (isLoading) {
    return <LoadingState label={t("loading")} />;
  }
  return (
    <Stack gap="$lg">
      {tableNames.length > 0 && (
        <Row flexWrap="wrap" gap="$sm" aria-label={t("filterByTable")}>
          <Chip
            label={t("all")}
            selected={selectedTable === null}
            onPress={() => setSelectedTable(null)}
          />
          {tableNames.map((tableName) => (
            <Chip
              key={tableName}
              label={tableName}
              selected={selectedTable === tableName}
              onPress={() => setSelectedTable(tableName)}
            />
          ))}
        </Row>
      )}

      {filteredData.length > 0 ? (
        <EvoluHistoryTable rows={filteredData} t={t} />
      ) : (
        <EmptyState title={t("evoluNoDataYet")} />
      )}

      {hasMore && (
        <Button
          alignSelf="center"
          onPress={handleLoadMore}
          loading={isLoadingMore}
          variant="secondary"
        >
          {t("loadMore")}
        </Button>
      )}

      {!hasMore && historyData.length > 0 && (
        <Text textAlign="center" color="$colorMuted">
          {t("allRecordsLoaded")}
        </Text>
      )}
    </Stack>
  );
}
