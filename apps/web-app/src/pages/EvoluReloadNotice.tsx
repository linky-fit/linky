import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useEvoluSettingsContext } from "../app/context/SystemSettingsContexts";
import { reportAppLog } from "../devtools/inspector/appLog";

export function EvoluReloadNotice(): React.ReactElement | null {
  const { evoluErrorType, evoluRelaysReloadRequired } =
    useEvoluSettingsContext();
  const { t } = useAppShellCore();
  if (!evoluRelaysReloadRequired && evoluErrorType !== "ProtocolQuotaError") {
    return null;
  }
  return (
    <>
      <p className="muted">
        {t(
          evoluRelaysReloadRequired
            ? "evoluRelaysReloadHint"
            : "evoluQuotaRecoveryHint",
        )}
      </p>
      <div className="settings-row">
        <button
          type="button"
          className="btn-wide secondary"
          onClick={() => {
            reportAppLog({
              tag: "EvoluSyncRetry",
              summary: "Reloading to retry Evolu synchronization",
              payload: {
                errorType: evoluErrorType,
                settingsChanged: evoluRelaysReloadRequired,
              },
            });
            window.location.reload();
          }}
        >
          {t(
            evoluRelaysReloadRequired
              ? "evoluRelaysReloadButton"
              : "evoluRetrySync",
          )}
        </button>
      </div>
    </>
  );
}
