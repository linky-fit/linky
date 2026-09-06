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
    pendingEvoluServerDeleteUrl,
    saveEvoluServerUrls,
    setEvoluServerOffline,
    setPendingEvoluServerDeleteUrl,
    setStatus,
    syncOwner,
  } = useEvoluSettingsContext();
  const { route, t } = useAppShellCore();
  const selectedEvoluServerUrl = route.kind === "evoluServer" ? route.id : null;

  return (
    <section className="panel">
      <EvoluSyncErrorNotice />
      <EvoluReloadNotice />

      {selectedEvoluServerUrl ? (
        <>
          {(() => {
            const offline = isEvoluServerOffline(selectedEvoluServerUrl);
            const isLastServer = evoluServerUrls.length <= 1;
            const { state, labelKey } = deriveEvoluServerState({
              evoluHasError,
              isOffline: offline,
              state: evoluServerStatusByUrl[selectedEvoluServerUrl],
              syncOwner,
            });

            return (
              <>
                <div className="settings-row">
                  <div className="settings-left">
                    <span className="relay-url">{selectedEvoluServerUrl}</span>
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
                      {t("evoluServerOfflineLabel")}
                    </span>
                  </div>
                  <div className="settings-right">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setEvoluServerOffline(selectedEvoluServerUrl, !offline);
                      }}
                    >
                      {offline
                        ? t("evoluServerOfflineEnable")
                        : t("evoluServerOfflineDisable")}
                    </button>
                  </div>
                </div>

                {isLastServer ? (
                  <p className="muted settings-error-note">
                    {t("evoluDefaultServerCannotRemove")}
                  </p>
                ) : (
                  <div className="settings-row settings-error-note">
                    <button
                      type="button"
                      className="btn-wide danger"
                      onClick={() => {
                        if (
                          pendingEvoluServerDeleteUrl === selectedEvoluServerUrl
                        ) {
                          const selectedLower =
                            selectedEvoluServerUrl.toLowerCase();
                          const nextUrls = evoluServerUrls.filter(
                            (u) => u.toLowerCase() !== selectedLower,
                          );
                          setPendingEvoluServerDeleteUrl(null);
                          setEvoluServerOffline(selectedEvoluServerUrl, false);
                          saveEvoluServerUrls(nextUrls);
                          navigateTo({ route: "evoluServers" });
                          return;
                        }

                        setStatus(t("deleteArmedHint"));
                        setPendingEvoluServerDeleteUrl(selectedEvoluServerUrl);
                      }}
                    >
                      {t("evoluServerRemove")}
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
