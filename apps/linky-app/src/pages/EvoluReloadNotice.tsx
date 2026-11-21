import { Notice } from "@linky-fit/ui";
import React from "react";
import { useTranslation } from "../app/hooks/shell";
import {
  useEvoluErrorType,
  useEvoluReloadRequired,
} from "../app/hooks/settings/useEvoluSettings";
import { reportAppLog } from "../devtools/inspector/appLog";
import { retryQuotaSync, useOpenedEvolu } from "../evolu";

export function EvoluReloadNotice(): React.ReactElement | null {
  const evoluErrorType = useEvoluErrorType();
  const evoluServersReloadRequired = useEvoluReloadRequired();
  const { evolu, run } = useOpenedEvolu();
  const { t } = useTranslation();
  if (!evoluServersReloadRequired && evoluErrorType !== "ProtocolQuotaError") {
    return null;
  }
  return (
    <Notice
      tone="accent"
      title={t(
        evoluServersReloadRequired
          ? "evoluServersReloadHint"
          : "evoluQuotaRecoveryHint",
      )}
      action={{
        label: t(
          evoluServersReloadRequired
            ? "evoluServersReloadButton"
            : "evoluRetrySync",
        ),
        onPress: () => {
          if (evoluServersReloadRequired) {
            reportAppLog({
              tag: "EvoluSyncRetry",
              summary: "Reloading to apply Evolu server changes",
              payload: {
                errorType: evoluErrorType,
                settingsChanged: true,
              },
            });
            window.location.reload();
            return;
          }
          const owners = retryQuotaSync(evolu, run.deps.syncState.get());
          reportAppLog({
            tag: "EvoluSyncRetry",
            summary: `Requested sync retry for ${owners.length} quota-blocked owners`,
            payload: {
              errorType: evoluErrorType,
              settingsChanged: false,
              owners,
            },
          });
        },
      }}
    />
  );
}
