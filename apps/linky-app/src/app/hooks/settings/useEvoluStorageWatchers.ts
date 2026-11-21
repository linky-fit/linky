import { useAtom } from "@linky-fit/linkstr-react";
import React from "react";
import {
  useEvoluDatabaseInfoState,
  useEvoluLastError,
  useEvoluServerProbes,
  useWipeEvoluStorage,
} from "../../../evolu";
import type { Route } from "../../../types/route";
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

/**
 * Evolu's error watch, relay probes, database info for the Evolu pages, and
 * the user's storage reset. Mounted once by the shell.
 */
export const useEvoluStorageWatchers = (route: Route): void => {
  const pushToast = usePushToast();
  const { t } = useTranslation();
  const evoluLastError = useEvoluLastError({ logToConsole: true });
  const wipeEvoluStorageImpl = useWipeEvoluStorage();
  const [wipeIsBusy, setWipeIsBusy] = useAtom(evoluWipeBusyAtom);
  useEvoluServerProbes();
  useEvoluDatabaseInfoState({ enabled: EVOLU_PAGES.has(route.kind) });

  const wipeEvoluStorage = React.useCallback(async () => {
    // Evolu keeps quota errors after another relay converges; successful probes
    // and dismissed warnings are not proof of recovery.
    if (evoluLastError?.type === "ProtocolQuotaError") {
      pushToast(t("evoluQuotaRecoveryHint"));
      return;
    }
    if (wipeIsBusy) return;
    setWipeIsBusy(true);

    try {
      wipeEvoluStorageImpl();
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
