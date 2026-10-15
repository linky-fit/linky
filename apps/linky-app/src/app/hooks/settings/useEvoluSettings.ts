import { useAtom, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { useEvoluServers } from "../../../evolu";
import {
  evoluClearArm,
  evoluDatabaseInfoAtom,
  evoluLastErrorAtom,
  evoluStorageCommandsAtom,
  evoluWipeBusyAtom,
  newEvoluServerUrlAtom,
} from "../../state/session/evoluSettings";
import { usePushToast, useSetStatus, useTranslation } from "../shell";
import {
  useAppOwnerId,
  useShardRotation,
  useShardSummaries,
  useSyncOwnerIds,
} from "../useLinksync";

export const useEvoluErrorType = () =>
  useAtomValue(evoluLastErrorAtom)?.type ?? null;

/** The Evolu relay list changed since the app started. */
export const useEvoluReloadRequired = () => useEvoluServers().reloadRequired;

/** The user's two-tap reset of the local database. */
export const useClearEvoluDatabase = () => {
  const armed = useAtomValue(evoluClearArm.valueAtom) !== null;
  const arm = useAtomValue(evoluClearArm.commandsAtom);
  const commands = useAtomValue(evoluStorageCommandsAtom);
  const pushToast = usePushToast();
  const { t } = useTranslation();
  const requestClearDatabase = React.useCallback(() => {
    if (!armed) {
      arm.arm(true);
      pushToast(t("deleteArmedHint"));
      return;
    }
    arm.disarm();
    void commands?.read().wipeEvoluStorage();
  }, [arm, armed, commands, pushToast, t]);
  return {
    clearDatabaseArmed: armed,
    evoluWipeStorageIsBusy: useAtomValue(evoluWipeBusyAtom),
    requestClearDatabase,
  };
};

/** Everything the Evolu settings pages show and change. */
export const useEvoluSettings = () => {
  const servers = useEvoluServers();
  const error = useAtomValue(evoluLastErrorAtom);
  const info = useAtomValue(evoluDatabaseInfoAtom);
  const shardRotation = useShardRotation();
  const [newEvoluServerUrl, setNewEvoluServerUrl] = useAtom(
    newEvoluServerUrlAtom,
  );
  return {
    ...useClearEvoluDatabase(),
    evoluDatabaseBytes: info.bytes,
    evoluErrorType: error?.type ?? null,
    evoluHasError: error !== null,
    evoluHistoryCount: info.historyCount,
    evoluServerStatusByUrl: servers.statusByUrl,
    evoluServerUrls: servers.configuredUrls,
    evoluServersReloadRequired: servers.reloadRequired,
    evoluShards: useShardSummaries(),
    evoluSyncOwnerIds: useSyncOwnerIds(),
    evoluTableCounts: info.tableCounts,
    isEvoluServerOffline: servers.isOffline,
    isEvoluServerRecommended: servers.isRecommended,
    newEvoluServerUrl,
    requestRotateShard: shardRotation.rotate,
    rotatingShardScope: shardRotation.busyScope,
    saveEvoluServerUrls: servers.setServerUrls,
    setEvoluServerOffline: servers.setServerOffline,
    setNewEvoluServerUrl,
    setStatus: useSetStatus(),
    syncOwnerId: useAppOwnerId(),
  };
};

/** How many active Evolu relays answer, and the sync status Settings summarizes. */
export const useEvoluStatusSummary = () => {
  const { activeUrls, configuredUrls, statusByUrl } = useEvoluServers();
  const hasError = useAtomValue(evoluLastErrorAtom) !== null;
  const appOwnerId = useAppOwnerId();
  const evoluConnectedServerCount = activeUrls.filter(
    (url) => statusByUrl[url] === "connected",
  ).length;
  const evoluOverallStatus = ((): "checking" | "connected" | "disconnected" => {
    if (!appOwnerId || hasError || activeUrls.length === 0) {
      return "disconnected";
    }
    const states = activeUrls.map((url) => statusByUrl[url] ?? "checking");
    if (states.some((s) => s === "connected")) return "connected";
    if (states.some((s) => s === "checking")) return "checking";
    return "disconnected";
  })();
  return {
    evoluConnectedServerCount,
    evoluOverallStatus,
    evoluServerUrls: configuredUrls,
  };
};
