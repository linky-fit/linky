import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useEvoluSettingsContext } from "../app/context/SystemSettingsContexts";
import { deriveEvoluRelayState } from "../app/lib/evoluRelayState";
import { navigateTo } from "../hooks/useRouting";
import { EvoluReloadNotice } from "./EvoluReloadNotice";
import { EvoluSyncErrorNotice } from "./EvoluSyncErrorNotice";

export function EvoluRelayPage(): React.ReactElement {
  const {
    evoluHasError,
    evoluRelayStatusByUrl,
    evoluRelayUrls,
    isEvoluRelayOffline,
    isEvoluRelayRecommended,
    pendingEvoluRelayDeleteUrl,
    saveEvoluRelayUrls,
    setEvoluRelayOffline,
    setPendingEvoluRelayDeleteUrl,
    setStatus,
    syncOwnerId,
  } = useEvoluSettingsContext();
  const { route, t } = useAppShellCore();
  const selectedEvoluRelayUrl = route.kind === "evoluRelay" ? route.id : null;

  return (
    <section className="panel">
      <EvoluSyncErrorNotice />
      <EvoluReloadNotice />

      {selectedEvoluRelayUrl ? (
        <>
          {(() => {
            const offline = isEvoluRelayOffline(selectedEvoluRelayUrl);
            const { state, labelKey } = deriveEvoluRelayState({
              evoluHasError,
              isOffline: offline,
              state: evoluRelayStatusByUrl[selectedEvoluRelayUrl],
              syncOwnerId,
            });

            return (
              <>
                <div className="settings-row">
                  <div className="settings-left">
                    <span className="relay-url">{selectedEvoluRelayUrl}</span>
                  </div>
                  <div className="settings-right">
                    <span
                      className={
                        state === "connected"
                          ? "status-dot connected"
                          : state === "checking"
                            ? "status-dot checking"
                            : "status-dot disconnected"
                      }
                      aria-label={state}
                      title={state}
                    />
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-left">
                    <span className="settings-label">
                      {t("evoluSyncLabel")}
                    </span>
                  </div>
                  <div className="settings-right">
                    <span className="muted">{t(labelKey)}</span>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-left">
                    <span className="settings-label">
                      {t("evoluRelayOfflineLabel")}
                    </span>
                  </div>
                  <div className="settings-right">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setEvoluRelayOffline(selectedEvoluRelayUrl, !offline);
                      }}
                    >
                      {offline
                        ? t("evoluRelayOfflineEnable")
                        : t("evoluRelayOfflineDisable")}
                    </button>
                  </div>
                </div>

                {isEvoluRelayRecommended(selectedEvoluRelayUrl) ? (
                  <p className="muted">{t("relayRecommendedNote")}</p>
                ) : (
                  <div className="settings-row settings-error-note">
                    <button
                      type="button"
                      className="btn-wide danger"
                      onClick={() => {
                        if (
                          pendingEvoluRelayDeleteUrl === selectedEvoluRelayUrl
                        ) {
                          const selectedLower =
                            selectedEvoluRelayUrl.toLowerCase();
                          const nextUrls = evoluRelayUrls.filter(
                            (u) => u.toLowerCase() !== selectedLower,
                          );
                          setPendingEvoluRelayDeleteUrl(null);
                          setEvoluRelayOffline(selectedEvoluRelayUrl, false);
                          saveEvoluRelayUrls(nextUrls);
                          navigateTo({ route: "evoluRelays" });
                          return;
                        }

                        setStatus(t("deleteArmedHint"));
                        setPendingEvoluRelayDeleteUrl(selectedEvoluRelayUrl);
                      }}
                    >
                      {t("evoluRelayRemove")}
                    </button>
                  </div>
                )}
              </>
            );
          })()}
        </>
      ) : (
        <p className="lede">{t("errorPrefix")}</p>
      )}
    </section>
  );
}
