import { Notice } from "@linky-fit/ui";
import React from "react";
import { useTranslation } from "../app/hooks/shell";
import { useEvoluErrorType } from "../app/hooks/settings/useEvoluSettings";

export function EvoluSyncErrorNotice(): React.ReactElement | null {
  const evoluErrorType = useEvoluErrorType();
  const { t } = useTranslation();
  if (!evoluErrorType) return null;
  return (
    <Notice
      tone="danger"
      title={t(
        evoluErrorType === "ProtocolQuotaError"
          ? "evoluQuotaExceeded"
          : "evoluSyncError",
      )}
    />
  );
}
