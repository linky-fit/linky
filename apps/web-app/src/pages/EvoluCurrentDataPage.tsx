import {
  Button,
  Card,
  DataValue,
  EmptyState,
  ListRow,
  LoadingState,
  Row,
  Section,
  Stack,
  Text,
} from "@linky-fit/ui";
import React, { useEffect, useState } from "react";
import { useTranslation } from "../app/hooks/shell";
import { useEvoluSettings } from "../app/hooks/settings/useEvoluSettings";
import { readRowOwnerId } from "../app/lib/rowOwnerId";
import {
  filterRowsToVisibleShards,
  scopeOfTable,
} from "../app/lib/shardTables";
import { EvoluCurrentTable } from "../components/EvoluCurrentTable";
import { loadEvoluCurrentData, useLinkyEvolu } from "../evolu";

const PREVIEW_ROW_COUNT = 2;

export function EvoluCurrentDataPage(): React.ReactElement {
  const { evoluShards, requestRotateShard, rotatingShardScope } =
    useEvoluSettings();
  const { t } = useTranslation();
  const evolu = useLinkyEvolu();
  const [currentData, setCurrentData] = useState<Awaited<
    ReturnType<typeof loadEvoluCurrentData>
  > | null>(null);
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>(
    {},
  );
  useEffect(() => {
    void loadEvoluCurrentData(evolu).then(setCurrentData);
  }, [evolu]);
  const dataSections = React.useMemo(
    () =>
      Object.entries(currentData ?? {})
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
  if (!currentData) return <LoadingState label={t("loading")} />;
  return (
    <Stack gap="$lg">
      <Section title={t("evoluShards")}>
        {evoluShards.map((shard) => (
          <Card key={shard.scope} outlined gap="$xs">
            <Row justifyContent="space-between">
              <Text variant="label">{shard.scope}</Text>
              {shard.rotates ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={rotatingShardScope === shard.scope}
                  disabled={rotatingShardScope !== null}
                  onPress={() => void requestRotateShard(shard.scope)}
                >
                  {t("evoluShardRotate").replace("{scope}", shard.scope)}
                </Button>
              ) : (
                <Text variant="label" color="$colorMuted">
                  {t("evoluShardFixed")}
                </Text>
              )}
            </Row>
            <ListRow title={t("evoluShardIndex")} value={shard.index} />
            <ListRow
              title={t("evoluShardVisibleCount")}
              value={shard.visibleOwnerIds.length}
            />
            <ListRow
              title={t("evoluShardOwner")}
              trailing={<DataValue value={shard.ownerId} />}
            />
          </Card>
        ))}
      </Section>

      {dataSections.map(({ tableName, scope, rows }) => {
        const shard = evoluShards.find((entry) => entry.scope === scope);
        const isExpanded = expandedTables[tableName] === true;
        const visibleRows = isExpanded
          ? rows
          : rows.slice(0, PREVIEW_ROW_COUNT);
        const hiddenRowsCount = rows.length - visibleRows.length;
        return (
          <Section key={tableName} title={tableName}>
            <Card outlined gap="$xs">
              <ListRow title={t("evoluTotalRows")} value={rows.length} />
              {shard ? (
                <ListRow
                  title={t("evoluShardIndex")}
                  value={`${shard.scope} / ${shard.index}`}
                />
              ) : null}
              {rows.length > 0 ? (
                <EvoluCurrentTable tableName={tableName} rows={visibleRows} />
              ) : (
                <EmptyState title={t("evoluNoDataYet")} />
              )}
              {rows.length > PREVIEW_ROW_COUNT ? (
                <Row flexWrap="wrap" justifyContent="space-between">
                  <Text variant="label" color="$colorMuted">
                    {isExpanded
                      ? t("evoluShowingAllRows")
                      : t("evoluShowingPreviewRows").replace(
                          "{count}",
                          String(visibleRows.length),
                        )}
                  </Text>
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() =>
                      setExpandedTables((current) => ({
                        ...current,
                        [tableName]: !isExpanded,
                      }))
                    }
                  >
                    {isExpanded
                      ? t("evoluHideSectionDetail")
                      : t("evoluShowSectionDetail").replace(
                          "{count}",
                          String(hiddenRowsCount),
                        )}
                  </Button>
                </Row>
              ) : null}
            </Card>
          </Section>
        );
      })}
    </Stack>
  );
}
