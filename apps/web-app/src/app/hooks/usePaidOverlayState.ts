import React from "react";

import type { Translate } from "../../i18n";
import type { PaidOverlayDetails } from "../lib/paidOverlay";

interface UsePaidOverlayStateParams {
  t: Translate;
}

interface UsePaidOverlayStateResult {
  paidOverlayIsOpen: boolean;
  paidOverlayTitle: string | null;
  paidOverlayDetails: PaidOverlayDetails | null;
  showPaidOverlay: (title?: string, details?: PaidOverlayDetails) => void;
  topupPaidNavTimerRef: React.MutableRefObject<number | null>;
}

export const usePaidOverlayState = ({
  t,
}: UsePaidOverlayStateParams): UsePaidOverlayStateResult => {
  const [paidOverlayIsOpen, setPaidOverlayIsOpen] = React.useState(false);
  const [paidOverlayTitle, setPaidOverlayTitle] = React.useState<string | null>(
    null,
  );
  const [paidOverlayDetails, setPaidOverlayDetails] =
    React.useState<PaidOverlayDetails | null>(null);
  const paidOverlayTimerRef = React.useRef<number | null>(null);
  const topupPaidNavTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const paidTimerRef = paidOverlayTimerRef;
    const topupNavTimerRef = topupPaidNavTimerRef;
    return () => {
      if (paidTimerRef.current !== null) {
        try {
          window.clearTimeout(paidTimerRef.current);
        } catch {
          // ignore
        }
      }
      paidTimerRef.current = null;

      if (topupNavTimerRef.current !== null) {
        try {
          window.clearTimeout(topupNavTimerRef.current);
        } catch {
          // ignore
        }
      }
      topupNavTimerRef.current = null;
    };
  }, []);

  const showPaidOverlay = React.useCallback(
    (title?: string, details?: PaidOverlayDetails) => {
      const resolved = title ?? t("paid");
      setPaidOverlayTitle(resolved);
      setPaidOverlayDetails(details ?? null);
      setPaidOverlayIsOpen(true);
      if (paidOverlayTimerRef.current !== null) {
        try {
          window.clearTimeout(paidOverlayTimerRef.current);
        } catch {
          // ignore
        }
      }
      paidOverlayTimerRef.current = window.setTimeout(() => {
        setPaidOverlayIsOpen(false);
        paidOverlayTimerRef.current = null;
      }, 2000);
    },
    [t],
  );

  return {
    paidOverlayDetails,
    paidOverlayIsOpen,
    paidOverlayTitle,
    showPaidOverlay,
    topupPaidNavTimerRef,
  };
};
