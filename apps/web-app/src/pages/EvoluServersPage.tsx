import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useEvoluSettingsContext } from "../app/context/SystemSettingsContexts";
import { deriveEvoluServerState } from "../app/lib/evoluServerState";
import { navigateTo } from "../hooks/useRouting";
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
    evoluTableCounts,
    evoluWipeStorageIsBusy,
    isEvoluServerOffline,
    requestClearDatabase,
    syncOwner,
  } = useEvoluSettingsContext();
  const { t } = useAppShellCore();

  const counts = Object.values(evoluTableCounts);
  const totalCurrentRows = counts.reduce<number | null>(
    (sum, count) => (sum === null || count === null ? null : sum + count),
    counts.length ? 0 : null,
  );

  return (
    <section className="panel">
      <EvoluSyncErrorNotice />
      <EvoluReloadNotice />
      {/* Server list */}
      {evoluServerUrls.length === 0 ? (
        <p className="muted evolu-server-empty">{t("evoluServersEmpty")}</p>
      ) : (
        <div className="evolu-server-list">
          {evoluServerUrls.map((url) => {
            const { state, labelKey } = deriveEvoluServerState({
              evoluHasError,
              isOffline: isEvoluServerOffline(url),
              state: evoluServerStatusByUrl[url],
              syncOwner,
            });

            return (
              <button
                type="button"
                className="settings-row settings-link"
                key={url}
                onClick={() => navigateTo({ route: "evoluServer", id: url })}
              >
                <div className="settings-left">
                  <span className="relay-url">{url}</span>
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
                  <span className="muted evolu-server-status-label">
                    {t(labelKey)}
                  </span>
                  <span className="settings-chevron" aria-hidden="true">
                    &gt;
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="settings-row evolu-data-section">
        <button
          type="button"
          className={
            clearDatabaseArmed
              ? "btn-wide secondary danger-armed"
              : "btn-wide secondary"
          }
          onClick={requestClearDatabase}
          disabled={
            evoluWipeStorageIsBusy || evoluErrorType === "ProtocolQuotaError"
          }
        >
          {t("evoluClearDatabase")}
        </button>
      </div>

      <h3 className="evolu-data-heading">{t("evoluRowCounts")}</h3>

      <div
        className="settings-row settings-link settings-row-layout"
        onClick={() => navigateTo({ route: "evoluCurrentData" })}
      >
        <div className="settings-left">
          <span className="settings-label">{t("evoluData")}</span>
        </div>
        <div className="settings-right">
          <span className="muted">
            {totalCurrentRows === null
              ? t("unknown")
              : `${totalCurrentRows} rows`}
          </span>
          <span className="settings-chevron" aria-hidden="true">
            &gt;
          </span>
        </div>
      </div>

      <div
        className="settings-row settings-link settings-row-layout"
        onClick={() => navigateTo({ route: "evoluHistoryData" })}
      >
        <div className="settings-left">
          <span className="settings-label">{t("evoluHistory")}</span>
        </div>
        <div className="settings-right">
          <span className="muted">
            {evoluHistoryCount === null
              ? t("unknown")
              : `${evoluHistoryCount} rows`}
          </span>
          <span className="settings-chevron" aria-hidden="true">
            &gt;
          </span>
        </div>
      </div>
    </section>
  );
}
