import { useAtomValue } from "@linky-fit/linkstr-react";
import { Button, LoadingState, Notice, QRCode, Stack } from "@linky-fit/ui";
import { type FC } from "react";
import { useCopyText, useTranslation } from "../app/hooks/shell";
import { useTopupInvoice } from "../app/hooks/topup/useTopupFlow";
import { defaultMintAtom } from "../app/state/wallet/defaultMint";
import { receiveMethodAtom } from "../app/state/wallet/prefs";
import { DisplayAmount } from "../components/DisplayAmount";
import type { Translate } from "../i18n";
import { MAIN_MINT_URL, normalizeMintUrl } from "../utils/mint";
import { optimizeCaseInsensitiveQrPayload } from "../utils/qrPayload";
import type { ReceiveMethod } from "../utils/receiveMethod";

interface TopupInvoicePageProps {
  copyText: (text: string) => Promise<void>;
  receiveMethod: ReceiveMethod;
  t: Translate;
  topupAmount: string;
  topupInvoice: string | null;
  topupInvoiceCashuRequest: string | null;
  topupInvoiceError: string | null;
  topupInvoiceIsBusy: boolean;
  topupMintUrl: string | null;
  topupInvoiceQrPayload: string | null;
}

export const TopupInvoicePage: FC<TopupInvoicePageProps> = ({
  copyText,
  receiveMethod,
  t,
  topupAmount,
  topupInvoice,
  topupInvoiceCashuRequest,
  topupInvoiceError,
  topupInvoiceIsBusy,
  topupMintUrl,
  topupInvoiceQrPayload,
}) => {
  const amountSat = Number.parseInt(topupAmount.trim(), 10);
  const mintDisplay = (topupMintUrl ?? "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const universalPayload =
    (topupInvoiceQrPayload ?? topupInvoice ?? "").trim() || null;
  const cashuPayload = (topupInvoiceCashuRequest ?? "").trim() || null;
  const lightningPayload = (topupInvoice ?? "").trim() || null;
  const preferredPayload =
    receiveMethod === "cashu"
      ? cashuPayload
      : receiveMethod === "lightning"
        ? lightningPayload
        : universalPayload;
  const selectedPayload = preferredPayload ?? universalPayload;
  const qrValue =
    selectedPayload !== null && selectedPayload === lightningPayload
      ? optimizeCaseInsensitiveQrPayload(selectedPayload)
      : selectedPayload;

  const handleCopyInvoice = () => {
    const copyValue = (selectedPayload ?? "").trim();
    if (!copyValue) return;
    void copyText(copyValue);
  };

  return (
    <Stack gap="$lg">
      <DisplayAmount
        amount={Number.isFinite(amountSat) && amountSat > 0 ? amountSat : 0}
        accessibilityLabel={t("topupInvoiceTitle")}
        caption={
          mintDisplay
            ? `${t("transactionDetailMint")}: ${mintDisplay}`
            : undefined
        }
      />

      {topupInvoiceIsBusy ? (
        <LoadingState label={t("topupFetchingInvoice")} />
      ) : qrValue ? (
        <Stack gap="$lg">
          <QRCode
            testID="topup-invoice-qr"
            value={qrValue}
            accessibilityLabel={t("copy")}
            badge="Copy"
            onPress={handleCopyInvoice}
          />
          <Button
            variant="secondary"
            icon="Copy"
            testID="topup-invoice-copy"
            onPress={handleCopyInvoice}
          >
            {t("copy")}
          </Button>
        </Stack>
      ) : topupInvoiceError ? (
        <Notice tone="danger" title={topupInvoiceError} />
      ) : (
        <LoadingState label={t("topupFetchingInvoice")} />
      )}
    </Stack>
  );
};

export const TopupInvoiceRoute: FC = () => {
  const { t } = useTranslation();
  const copyText = useCopyText();
  const receiveMethod = useAtomValue(receiveMethodAtom);
  const defaultMintUrl = useAtomValue(defaultMintAtom);
  const topup = useTopupInvoice();
  return (
    <TopupInvoicePage
      copyText={copyText}
      receiveMethod={receiveMethod}
      t={t}
      topupAmount={topup.topupAmount}
      topupInvoice={topup.topupInvoice}
      topupInvoiceCashuRequest={topup.topupInvoiceCashuRequest}
      topupInvoiceError={topup.topupInvoiceError}
      topupInvoiceIsBusy={topup.topupInvoiceIsBusy}
      topupInvoiceQrPayload={topup.topupInvoiceQrPayload}
      topupMintUrl={
        topup.topupMintUrl ??
        normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL) ??
        MAIN_MINT_URL
      }
    />
  );
};
