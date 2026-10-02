import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import {
  useAdvancedSettingsContext,
  useEvoluSettingsContext,
} from "../app/context/SystemSettingsContexts";
import { normalizeEvoluRelayUrl } from "../evolu";
import { navigateTo } from "../hooks/useRouting";

export function EvoluRelayNewPage(): React.ReactElement {
  const {
    evoluRelayUrls,
    newEvoluRelayUrl,
    saveEvoluRelayUrls,
    setNewEvoluRelayUrl,
    setStatus,
  } = useEvoluSettingsContext();
  const { t } = useAppShellCore();
  const { pushToast } = useAdvancedSettingsContext();

  return (
    <section className="panel">
      <label htmlFor="evoluRelayUrl">{t("evoluAddRelayLabel")}</label>
      <input
        id="evoluRelayUrl"
        value={newEvoluRelayUrl}
        onChange={(e) => setNewEvoluRelayUrl(e.target.value)}
        placeholder="wss://..."
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />

      <div className="panel-header panel-header-layout">
        <button
          type="button"
          onClick={() => {
            const normalized = normalizeEvoluRelayUrl(newEvoluRelayUrl);
            if (!normalized) {
              pushToast(t("evoluAddRelayInvalid"));
              return;
            }
            if (
              evoluRelayUrls.some(
                (u) => u.toLowerCase() === normalized.toLowerCase(),
              )
            ) {
              pushToast(t("evoluAddRelayAlready"));
              navigateTo({ route: "evoluRelays" });
              return;
            }

            saveEvoluRelayUrls([...evoluRelayUrls, normalized]);
            setNewEvoluRelayUrl("");
            setStatus(t("evoluAddRelaySaved"));
            navigateTo({ route: "evoluRelays" });
          }}
          disabled={!normalizeEvoluRelayUrl(newEvoluRelayUrl)}
        >
          {t("evoluAddRelayButton")}
        </button>
      </div>
    </section>
  );
}
