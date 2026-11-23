import { useAtom } from "@linky-fit/linkstr-react";
import React from "react";
import {
  useEvoluDatabaseInfoState,
  useEvoluLastError,
  useEvoluServerProbes,
  useWipeEvoluStorage,
} from "../../../evolu";
import { useDesktopSplitView } from "../../../hooks/useDesktopSplitView";
import type { Route } from "../../../types/route";
import { getDesktopRouteSection } from "../../routes/desktopRouteSection";
import {
  evoluStorageCommandsAtom,
  evoluWipeBusyAtom,
} from "../../state/session/evoluSettings";
import { usePushToast, useTranslation } from "../shell";
import { useProvideOwnerCommands } from "../shell/ownerCommands";

const EVOLU_PAGES: ReadonlySet<Route["kind"]> = new Set([
  "evoluServers",
  "evoluServer",
  "evoluServerNew",
  "evoluData",
  "evoluCurrentData",
  "evoluHistoryData",
]);

const EVOLU_PROBE_PAGES: ReadonlySet<Route["kind"]> = new Set([
  "settings",
  "advanced",
  "evoluServers",
  "evoluServer",
  "evoluServerNew",
]);

/**
 * Evolu's error watch, relay probes, database info for the Evolu pages, and
 * the user's storage reset. Mounted once by the shell.
 */
export const useEvoluStorageWatchers = (route: Route): void => {
  const isDesktopSplitView = useDesktopSplitView();
  const pushToast = usePushToast();
  const { t } = useTranslation();
  const evoluLastError = useEvoluLastError({ logToConsole: true });
  const wipeEvoluStorageImpl = useWipeEvoluStorage();
  const [wipeIsBusy, setWipeIsBusy] = useAtom(evoluWipeBusyAtom);
  const probeEvoluServers =
    EVOLU_PROBE_PAGES.has(route.kind) ||
    (isDesktopSplitView && getDesktopRouteSection(route) === "settings");
  useEvoluServerProbes({ enabled: probeEvoluServers });
  useEvoluDatabaseInfoState({ enabled: EVOLU_PAGES.has(route.kind) });

  const wipeEvoluStorage = React.useCallback(async () => {
    if (evoluLastError?.type === "ProtocolQuotaError") {
      pushToast(t("evoluQuotaRecoveryHint"));
      return;
    }
    if (wipeIsBusy) return;
    setWipeIsBusy(true);

    try {
      await wipeEvoluStorageImpl();
    } catch {
      pushToast(t("evoluWipeStorageFailed"));
    } finally {
      setWipeIsBusy(false);
    }
  }, [
    evoluLastError,
    pushToast,
    setWipeIsBusy,
    t,
    wipeEvoluStorageImpl,
    wipeIsBusy,
  ]);
  useProvideOwnerCommands(evoluStorageCommandsAtom, { wipeEvoluStorage });
};
