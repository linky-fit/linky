import {
  Button,
  EmptyState,
  ListRow,
  Notice,
  Section,
  Stack,
  StatusDot,
  Pill,
} from "@linky-fit/ui";
import { evoluSyncStatus } from "../utils/connectionStatus";

import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useEvoluSettingsContext } from "../app/context/SystemSettingsContexts";
import { deriveEvoluServerState } from "../app/lib/evoluServerState";
import { navigateTo } from "../hooks/useRouting";
import { formatEvoluRowCount } from "../utils/evoluRowCount";
import { EvoluReloadNotice } from "./EvoluReloadNotice";
import { EvoluSyncErrorNotice } from "./EvoluSyncErrorNotice";
export function EvoluServersPage(): React.ReactElement {
  const {
    clearDatabaseArmed,
    evoluHasError,
    evoluErrorType,
    evoluHistoryCount,
    evoluServerStatusByUrl,
    evoluServerUrls,
    evoluShards,
    evoluSyncOwnerIds,
    evoluTableCounts,
    evoluWipeStorageIsBusy,
    isEvoluServerOffline,
    isEvoluServerRecommended,
    requestClearDatabase,
    syncOwnerId,
  } = useEvoluSettingsContext();
  const { t } = useAppShellCore();
  const counts = Object.values(evoluTableCounts);
  const totalCurrentRows = counts.reduce<number | null>(
    (sum, count) => (sum === null || count === null ? null : sum + count),
    counts.length ? 0 : null,
  );
  return (
    <Stack gap="$lg">
      <EvoluSyncErrorNotice />
      <EvoluReloadNotice />
      {evoluServerUrls.every(isEvoluServerOffline) && (
        <Notice tone="accent" title={t("evoluNoBackupWarning")} />
      )}
      {/* Server list */}
      {evoluServerUrls.length === 0 ? (
        <EmptyState title={t("evoluServersEmpty")} />
      ) : (
        <Stack testID="evolu-server-list" gap="$xs">
          {evoluServerUrls.map((url) => {
            const status =
              evoluSyncStatus[
                deriveEvoluServerState({
                  evoluHasError,
                  isOffline: isEvoluServerOffline(url),
                  state: evoluServerStatusByUrl[url],
                  syncOwnerId,
                })
              ];
            return (
              <ListRow
                key={url}
                title={url}
                description={
                  isEvoluServerRecommended(url) ? (
                    <Pill size="sm" label={t("relayRecommended")} />
                  ) : undefined
                }
                value={t(status.labelKey)}
                trailing={
                  <StatusDot
                    tone={status.tone}
                    accessibilityLabel={t(status.labelKey)}
                  />
                }
                onPress={() => navigateTo({ route: "evoluServer", id: url })}
              />
            );
          })}
        </Stack>
      )}

      <Button
        onPress={requestClearDatabase}
        disabled={evoluErrorType === "ProtocolQuotaError"}
        loading={evoluWipeStorageIsBusy}
        variant={clearDatabaseArmed ? "danger" : "secondary"}
      >
        {t("evoluClearDatabase")}
      </Button>

      <Section title={t("evoluShards")}>
        {evoluShards.map((shard) => (
          <ListRow
            key={shard.scope}
            title={shard.scope}
            value={`${shard.index} (${shard.visibleOwnerIds.length} ${t("evoluShardVisibleCount").toLowerCase()})`}
          />
        ))}

        <ListRow
          title={t("evoluSyncedOwners")}
          value={evoluSyncOwnerIds.length}
          testID="evoluSyncedOwners"
        />
      </Section>

      <Section title={t("evoluRowCounts")}>
        <ListRow
          title={t("evoluData")}
          value={formatEvoluRowCount(t, totalCurrentRows)}
          testID="evoluData"
          onPress={() => navigateTo({ route: "evoluCurrentData" })}
        />

        <ListRow
          title={t("evoluHistory")}
          value={formatEvoluRowCount(t, evoluHistoryCount)}
          testID="evoluHistory"
          onPress={() => navigateTo({ route: "evoluHistoryData" })}
        />

        <ListRow
          icon="MessageCircle"
          title={t("chatStorage")}
          onPress={() => navigateTo({ route: "chatStorage" })}
        />
      </Section>
    </Stack>
  );
}
