import { useEffect, useState } from "react";
import { fetchLnurlPayPreview, type LnurlPayPreview } from "../lnurlPay";
import type { Translate } from "../i18n";

interface PreviewState {
  error: string | null;
  preview: LnurlPayPreview | null;
  target: string;
}

export interface LnurlPayPreviewResult {
  error: string | null;
  /** Set when the target accepts exactly one amount (minSendable === maxSendable). */
  fixedAmountSat: number | null;
  loading: boolean;
  preview: LnurlPayPreview | null;
}

/**
 * Loads the LNURL-pay request for a lightning address or LNURL target so the
 * payment form can prefill a fixed amount and validate against min/max before
 * the user submits. Pass an empty target to keep the preview idle.
 */
export const useLnurlPayPreview = (
  paymentTarget: string,
): LnurlPayPreviewResult => {
  const [state, setState] = useState<PreviewState>({
    error: null,
    preview: null,
    target: "",
  });

  const target = paymentTarget.trim();
  const loaded = state.target === target;
  const loading = target !== "" && !loaded;
  const preview = target !== "" && loaded ? state.preview : null;
  const error = target !== "" && loaded ? state.error : null;

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    fetchLnurlPayPreview(target)
      .then((next) => {
        if (cancelled) return;
        setState({ error: null, preview: next, target });
      })
      .catch((unknownError: unknown) => {
        if (cancelled) return;
        const message =
          unknownError instanceof Error
            ? unknownError.message
            : String(unknownError ?? "");
        setState({
          error: message || "LNURL error",
          preview: null,
          target,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [target]);

  const fixedAmountSat =
    preview !== null && preview.minSendableSat === preview.maxSendableSat
      ? preview.minSendableSat
      : null;

  return { error, fixedAmountSat, loading, preview };
};

export const getLnurlPayAmountRangeError = (
  preview: LnurlPayPreview | null,
  amountSat: number,
  t: Translate,
): string | null => {
  if (!preview || !Number.isFinite(amountSat) || amountSat <= 0) return null;
  if (amountSat < preview.minSendableSat) {
    return t("lnurlPayAmountTooLow").replace(
      "{min}",
      String(preview.minSendableSat),
    );
  }
  if (amountSat > preview.maxSendableSat) {
    return t("lnurlPayAmountTooHigh").replace(
      "{max}",
      String(preview.maxSendableSat),
    );
  }
  return null;
};
