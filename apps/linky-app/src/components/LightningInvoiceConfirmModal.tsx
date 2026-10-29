import type { LightningInvoicePreview } from "@linky-fit/linkshu";
import { Stack, Text } from "@linky-fit/ui";
import React from "react";
import { useExactAmountText } from "../app/hooks/useExactAmountText";
import type { LightningInvoiceQuoteState } from "../app/state/shell/confirmations";
import type { Translate } from "../i18n";
import { PaymentConfirmDialog } from "./PaymentConfirmDialog";

interface LightningInvoiceConfirmModalProps {
  cashuBalance: number;
  cashuIsBusy: boolean;
  confirmation: LightningInvoicePreview;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  /** The fee estimate for `confirmation`; null before it was asked for. */
  quote: LightningInvoiceQuoteState["outcome"] | null;
  t: Translate;
}

/** An invoice with more time left than this expires nobody's attention; the countdown shows under it. */
const EXPIRY_SHOWN_UNDER_SEC = 5 * 60;

const formatRemainingLifetime = (
  remainingSeconds: number | null,
): string | null => {
  if (
    !Number.isFinite(remainingSeconds) ||
    remainingSeconds === null ||
    remainingSeconds < 0 ||
    remainingSeconds >= EXPIRY_SHOWN_UNDER_SEC
  ) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.floor(remainingSeconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

const caption = (text: string, key: string) => (
  <Text key={key} variant="caption" bold color="$colorMuted" textAlign="center">
    {text}
  </Text>
);

export function LightningInvoiceConfirmModal({
  cashuBalance,
  cashuIsBusy,
  confirmation,
  onClose,
  onConfirm,
  quote,
  t,
}: LightningInvoiceConfirmModalProps): React.ReactElement {
  const { exact } = useExactAmountText();
  const [nowMs, setNowMs] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (confirmation.expiresAtSec === null) return;

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [confirmation.expiresAtSec]);

  const expiresLabel = formatRemainingLifetime(
    confirmation.expiresAtSec === null
      ? null
      : confirmation.expiresAtSec - nowMs / 1000,
  );
  const insufficientBalance =
    confirmation.amountSat !== null && confirmation.amountSat > cashuBalance;

  const feeLines =
    quote === null
      ? []
      : quote === "pending"
        ? [caption(t("payFeeEstimating"), "fee")]
        : quote._tag === "Quoted"
          ? [
              caption(
                t("paymentRequestFees").replace("{fee}", exact(quote.fee)),
                "fee",
              ),
            ]
          : quote._tag === "Failed" || quote._tag === "NetworkError"
            ? [caption(t("mintMoveEstimateFailed"), "fee")]
            : [];

  return (
    <PaymentConfirmDialog
      amountSat={confirmation.amountSat}
      label={t("pay")}
      confirmLabel={t("paySend")}
      cancelLabel={t("payCancel")}
      description={confirmation.description}
      meta={
        <Stack alignItems="center" gap="$xxs">
          {expiresLabel ? caption(expiresLabel, "expires") : null}
          {feeLines}
        </Stack>
      }
      unknownAmountLabel={t("lightningInvoiceConfirmUnknownAmount")}
      isBusy={cashuIsBusy}
      disabled={insufficientBalance}
      {...(insufficientBalance ? { disabledReason: t("payInsufficient") } : {})}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
