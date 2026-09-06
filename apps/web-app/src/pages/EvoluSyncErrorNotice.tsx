import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useEvoluSettingsContext } from "../app/context/SystemSettingsContexts";

export function EvoluSyncErrorNotice(): React.ReactElement | null {
  const { evoluErrorType } = useEvoluSettingsContext();
  const { t } = useAppShellCore();
  if (!evoluErrorType) return null;
  return (
    <p role="alert">
      {t(
        evoluErrorType === "ProtocolQuotaError"
          ? "evoluQuotaExceeded"
          : "evoluSyncError",
      )}
    </p>
  );
}
