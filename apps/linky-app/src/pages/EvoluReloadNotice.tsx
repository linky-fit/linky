import { Notice } from "@linky-fit/ui";
import React from "react";
import { useTranslation } from "../app/hooks/shell";
import {
  useEvoluErrorType,
  useEvoluReloadRequired,
} from "../app/hooks/settings/useEvoluSettings";
import { reportAppLog } from "../devtools/inspector/appLog";
import { reloadApp } from "../platform/reload";

export function EvoluReloadNotice(): React.ReactElement | null {
  const evoluErrorType = useEvoluErrorType();
  const evoluServersReloadRequired = useEvoluReloadRequired();
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
          reportAppLog({
            tag: "EvoluSyncRetry",
            summary: "Reloading to retry Evolu synchronization",
            payload: {
              errorType: evoluErrorType,
              settingsChanged: evoluServersReloadRequired,
            },
          });
          reloadApp();
        },
      }}
    />
  );
}
