// Migration bridge; removal gate in app/migrations/AGENTS.md
import type { SettingsRepository } from "@linky-fit/linksync";
import React from "react";
import { getInspectorEmissionEnabled } from "../../devtools/inspector/inspectorEnabled";
import { reportInspectorRows } from "../../devtools/inspector/reportInspectorRows";
import { parseProfileGeneralStatus } from "../../nostrStatus";
import { runWrite } from "../lib/storeWrite";

/**
 * Carries the currencies the own profile status offers into the synced
 * `proxyPaymentCurrencies` setting once the account is hydrated, so the
 * listings document names them without the user choosing them again. A set
 * setting, an empty one included, is the user's choice and stays.
 */
export const useProxyPaymentCurrenciesMigration = ({
  setting,
  status,
  settingsRepository,
  hydrated,
}: {
  readonly setting: ReadonlyArray<string> | null;
  readonly status: string | null;
  readonly settingsRepository: Pick<SettingsRepository, "set">;
  readonly hydrated: boolean;
}): void => {
  const runningRef = React.useRef(false);
  React.useEffect(() => {
    if (!hydrated || setting !== null || runningRef.current) return;
    const currencies = parseProfileGeneralStatus(status).currencies;
    if (currencies.length === 0) return;
    runningRef.current = true;
    void runWrite(
      settingsRepository.set("proxyPaymentCurrencies", currencies),
    ).then((outcome) => {
      runningRef.current = false;
      if (!outcome.ok || !getInspectorEmissionEnabled()) return;
      reportInspectorRows([
        {
          at: Date.now(),
          channel: "evolu.migration",
          tag: "ProxyPaymentCurrenciesMovedToSetting",
          links: {},
          summary: `Carried proxy payment currencies ${currencies.join(", ")} over from the profile status`,
          payload: { currencies },
        },
      ]);
    });
  }, [hydrated, setting, settingsRepository, status]);
};
