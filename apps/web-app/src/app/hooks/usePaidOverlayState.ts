import React from "react";

import type { Translate } from "../../i18n";
import type { PaidOverlayDetails, PaidOverlayPhase } from "../lib/paidOverlay";

interface UsePaidOverlayStateParams {
  t: Translate;
}

interface PaidOverlayState {
  details: PaidOverlayDetails | null;
  phase: PaidOverlayPhase;
  title: string | null;
}

interface UsePaidOverlayStateResult {
  dismissPaymentSending: () => void;
  paidOverlayIsOpen: boolean;
  paidOverlayPhase: PaidOverlayPhase;
  paidOverlayTitle: string | null;
  paidOverlayDetails: PaidOverlayDetails | null;
  showPaidOverlay: (title?: string, details?: PaidOverlayDetails) => void;
  showPaymentSending: (details: PaidOverlayDetails) => void;
  topupPaidNavTimerRef: React.MutableRefObject<number | null>;
}

const PAID_OVERLAY_DURATION_MS = 2000;

/**
 * The paid overlay opens in the `sending` phase as soon as a payment starts
 * and stays until `showPaidOverlay` turns it into the `done` confirmation,
 * which closes itself; `dismissPaymentSending` closes it when the payment
 * ends without one.
 */
export const usePaidOverlayState = ({
  t,
}: UsePaidOverlayStateParams): UsePaidOverlayStateResult => {
  const [overlay, setOverlay] = React.useState<PaidOverlayState | null>(null);
  const paidOverlayTimerRef = React.useRef<number | null>(null);
  const topupPaidNavTimerRef = React.useRef<number | null>(null);

  const clearPaidOverlayTimer = React.useCallback(() => {
    if (paidOverlayTimerRef.current !== null) {
      window.clearTimeout(paidOverlayTimerRef.current);
    }
    paidOverlayTimerRef.current = null;
  }, []);

  React.useEffect(() => {
    const topupNavTimerRef = topupPaidNavTimerRef;
    return () => {
      clearPaidOverlayTimer();
      if (topupNavTimerRef.current !== null) {
        window.clearTimeout(topupNavTimerRef.current);
      }
      topupNavTimerRef.current = null;
    };
  }, [clearPaidOverlayTimer]);

  const showPaymentSending = React.useCallback(
    (details: PaidOverlayDetails) => {
      clearPaidOverlayTimer();
      setOverlay({ details, phase: "sending", title: null });
    },
    [clearPaidOverlayTimer],
  );

  const dismissPaymentSending = React.useCallback(() => {
    setOverlay((current) => (current?.phase === "sending" ? null : current));
  }, []);

  const showPaidOverlay = React.useCallback(
    (title?: string, details?: PaidOverlayDetails) => {
      clearPaidOverlayTimer();
      setOverlay({
        details: details ?? null,
        phase: "done",
        title: title ?? t("paid"),
      });
      paidOverlayTimerRef.current = window.setTimeout(() => {
        setOverlay(null);
        paidOverlayTimerRef.current = null;
      }, PAID_OVERLAY_DURATION_MS);
    },
    [clearPaidOverlayTimer, t],
  );

  return {
    dismissPaymentSending,
    paidOverlayDetails: overlay?.details ?? null,
    paidOverlayIsOpen: overlay !== null,
    paidOverlayPhase: overlay?.phase ?? "done",
    paidOverlayTitle: overlay?.title ?? null,
    showPaidOverlay,
    showPaymentSending,
    topupPaidNavTimerRef,
  };
};
