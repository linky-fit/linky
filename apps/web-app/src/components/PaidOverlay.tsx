import React from "react";
import type { Translate } from "../i18n";

interface PaidOverlayProps {
  paidOverlayTitle: string | null;
  t: Translate;
}

export function PaidOverlay({
  paidOverlayTitle,
  t,
}: PaidOverlayProps): React.ReactElement {
  return (
    <div className="paid-overlay" role="status" aria-live="assertive">
      <div className="paid-sheet">
        <div className="paid-check" aria-hidden="true">
          ✓
        </div>
        <div className="paid-title">{paidOverlayTitle ?? t("paid")}</div>
      </div>
    </div>
  );
}
