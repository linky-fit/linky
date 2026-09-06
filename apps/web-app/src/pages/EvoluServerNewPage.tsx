import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import {
  useAdvancedSettingsContext,
  useEvoluSettingsContext,
} from "../app/context/SystemSettingsContexts";
import { normalizeEvoluServerUrl } from "../evolu";
import { navigateTo } from "../hooks/useRouting";

export function EvoluServerNewPage(): React.ReactElement {
  const {
    evoluServerUrls,
    newEvoluServerUrl,
    saveEvoluServerUrls,
    setNewEvoluServerUrl,
    setStatus,
  } = useEvoluSettingsContext();
  const { t } = useAppShellCore();
  const { pushToast } = useAdvancedSettingsContext();

  return (
    <section className="panel">
      <label htmlFor="evoluServerUrl">{t("evoluAddServerLabel")}</label>
      <input
        id="evoluServerUrl"
        value={newEvoluServerUrl}
        onChange={(e) => setNewEvoluServerUrl(e.target.value)}
        placeholder="wss://..."
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />

      <div className="panel-header panel-header-layout">
        <button
          type="button"
          onClick={() => {
            const normalized = normalizeEvoluServerUrl(newEvoluServerUrl);
            if (!normalized) {
              pushToast(t("evoluAddServerInvalid"));
              return;
            }
            if (
              evoluServerUrls.some(
                (u) => u.toLowerCase() === normalized.toLowerCase(),
              )
            ) {
              pushToast(t("evoluAddServerAlready"));
              navigateTo({ route: "evoluServers" });
              return;
            }

            saveEvoluServerUrls([...evoluServerUrls, normalized]);
            setNewEvoluServerUrl("");
            setStatus(t("evoluAddServerSaved"));
            navigateTo({ route: "evoluServers" });
          }}
          disabled={!normalizeEvoluServerUrl(newEvoluServerUrl)}
        >
          {t("evoluAddServerButton")}
        </button>
      </div>
    </section>
  );
}
