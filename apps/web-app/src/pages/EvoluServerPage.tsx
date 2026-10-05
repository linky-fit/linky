import {
  Button,
  ListRow,
  Notice,
  Stack,
  StatusDot,
  Switch,
  Text,
} from "@linky-fit/ui";
import { evoluSyncStatus } from "../utils/connectionStatus";
import { useArmedAction } from "../hooks/useArmedAction";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useEvoluSettingsContext } from "../app/context/SystemSettingsContexts";
import { deriveEvoluServerState } from "../app/lib/evoluServerState";
import { navigateTo } from "../hooks/useRouting";
import { EvoluReloadNotice } from "./EvoluReloadNotice";
import { EvoluSyncErrorNotice } from "./EvoluSyncErrorNotice";
export function EvoluServerPage(): React.ReactElement {
  const {
    evoluHasError,
    evoluServerStatusByUrl,
    evoluServerUrls,
    isEvoluServerOffline,
    isEvoluServerRecommended,
    saveEvoluServerUrls,
    setEvoluServerOffline,
    setStatus,
    syncOwnerId,
  } = useEvoluSettingsContext();
  const { route, t } = useAppShellCore();
  const deleteAction = useArmedAction(() => setStatus(t("deleteArmedHint")));
  const url = route.kind === "evoluServer" ? route.id : null;
  if (!url) return <Notice tone="danger" title={t("errorPrefix")} />;

  const offline = isEvoluServerOffline(url);
  const status =
    evoluSyncStatus[
      deriveEvoluServerState({
        evoluHasError,
        isOffline: offline,
        state: evoluServerStatusByUrl[url],
        syncOwnerId,
      })
    ];
  const removeServer = () => {
    setEvoluServerOffline(url, false);
    saveEvoluServerUrls(
      evoluServerUrls.filter((u) => u.toLowerCase() !== url.toLowerCase()),
    );
    navigateTo({ route: "relays" });
  };
  return (
    <Stack gap="$lg">
      <EvoluSyncErrorNotice />
      <EvoluReloadNotice />

      <ListRow
        title={url}
        trailing={
          <StatusDot
            tone={status.tone}
            accessibilityLabel={t(status.labelKey)}
          />
        }
      />

      <ListRow
        title={t("evoluSyncLabel")}
        value={t(status.labelKey)}
        testID="evoluSyncLabel"
      />

      <ListRow
        title={t("evoluServerOfflineLabel")}
        trailing={
          <Switch
            accessibilityLabel={t("evoluServerOfflineLabel")}
            value={offline}
            onValueChange={(value) => setEvoluServerOffline(url, value)}
          />
        }
        testID="evoluServerOfflineLabel"
      />

      {isEvoluServerRecommended(url) ? (
        <Text variant="label" color="$colorMuted">
          {t("relayRecommendedNote")}
        </Text>
      ) : (
        <Button
          onPress={() => deleteAction.confirm(removeServer)}
          variant={deleteAction.armed ? "danger" : "secondary"}
        >
          {t("evoluServerRemove")}
        </Button>
      )}
    </Stack>
  );
}
