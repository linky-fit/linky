import { Avatar, Button, Stack, Text } from "@linky-fit/ui";
import { useEffect, type FC } from "react";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import { useWalletBalance } from "../app/hooks/wallet/useWalletInventory";
import {
  useKnownLnAddressPayContact,
  useLnAddressPayDraft,
} from "../app/hooks/wallet/usePaymentDrafts";
import { LightningFeeHint } from "../components/LightningFeeHint";
import { LnurlPayPreviewNotices } from "../components/LnurlPayPreviewNotices";
import { PaymentAmountPanel } from "../components/PaymentAmountPanel";
import {
  getLnurlPayAmountRangeError,
  useLnurlPayPreview,
} from "../hooks/useLnurlPayPreview";
import {
  getLnurlPayDisplayText,
  inferLightningAddressFromLnurlTarget,
  type LnurlPayPreview,
} from "../lnurlPay";
import { formatMiddleDots } from "../utils/formatting";
import { useWalletCommands } from "../app/hooks/wallet/useWalletCommands";

interface LnAddressPayKnownContact {
  lnAddress?: string | null;
  name?: string | null;
}

interface LnAddressPayPageProps {
  knownContact: LnAddressPayKnownContact | null;
  knownContactPictureUrl: string | null;
  lnAddress: string;
  lnAddressPayAmount: string;
  lnAddressPayNote: string;
  payLightningAddressWithCashu: (
    lnAddress: string,
    amountSat: number,
    comment: string | null,
    preview: LnurlPayPreview | null,
  ) => Promise<void>;
  setLnAddressPayAmount: (value: string | ((prev: string) => string)) => void;
  setLnAddressPayNote: (value: string) => void;
}

export const LnAddressPayPage: FC<LnAddressPayPageProps> = ({
  knownContact,
  knownContactPictureUrl,
  lnAddress,
  lnAddressPayAmount,
  lnAddressPayNote,
  payLightningAddressWithCashu,
  setLnAddressPayAmount,
  setLnAddressPayNote,
}) => {
  const { t } = useTranslation();
  const { formatDisplayedAmountText } = useDisplayAmounts();
  const { canPayWithCashu, cashuBalance, cashuBalanceAfterMelt, cashuIsBusy } =
    useWalletBalance();
  const {
    error: previewError,
    fixedAmountSat,
    loading: previewLoading,
    preview,
  } = useLnurlPayPreview(lnAddress);

  useEffect(() => {
    if (fixedAmountSat === null) return;
    const next = String(fixedAmountSat);
    setLnAddressPayAmount((current) => (current === next ? current : next));
  }, [fixedAmountSat, setLnAddressPayAmount]);

  const amountSat = Number.parseInt(lnAddressPayAmount.trim(), 10);
  const displayTarget = formatMiddleDots(getLnurlPayDisplayText(lnAddress), 36);
  const inferredLightningAddress =
    inferLightningAddressFromLnurlTarget(lnAddress);
  const displayAddress = formatMiddleDots(
    knownContact?.lnAddress ??
      preview?.lightningAddress ??
      inferredLightningAddress ??
      displayTarget,
    36,
  );
  const canCoverAnything = cashuBalance > 0;
  const availableAmountText = `${t("availablePrefix")} ${formatDisplayedAmountText(
    cashuBalance,
  )}`;

  const rangeError = getLnurlPayAmountRangeError(preview, amountSat, t);
  // LUD-12: only a recipient that accepts comments gets a note.
  const commentAllowed = preview?.commentAllowed ?? 0;

  const invalid =
    !canPayWithCashu ||
    !Number.isFinite(amountSat) ||
    amountSat <= 0 ||
    amountSat > cashuBalanceAfterMelt ||
    previewLoading ||
    previewError !== null ||
    rangeError !== null;

  // The recipient's limit first: topping up would not lift it.
  const submitBlockedReason =
    rangeError ??
    (amountSat > cashuBalanceAfterMelt ? t("payInsufficient") : undefined);

  return (
    <PaymentAmountPanel
      amount={lnAddressPayAmount}
      cashuIsBusy={cashuIsBusy || previewLoading}
      amountHint={
        amountSat > 0 ? <LightningFeeHint amountSat={amountSat} /> : null
      }
      header={
        <Stack alignItems="center" gap="$xs">
          <Avatar
            name={knownContact?.name || displayAddress}
            uri={knownContactPictureUrl ?? undefined}
            size="md"
          />
          {knownContact?.name ? (
            <Text variant="title" numberOfLines={1}>
              {knownContact.name}
            </Text>
          ) : null}
          <Text color="$colorMuted" textAlign="center" numberOfLines={1}>
            {displayAddress}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            disabled={!canCoverAnything}
            onPress={() => setLnAddressPayAmount(String(cashuBalance))}
          >
            {availableAmountText}
          </Button>
        </Stack>
      }
      note={
        commentAllowed > 0
          ? {
              maxLength: commentAllowed,
              onChange: setLnAddressPayNote,
              value: lnAddressPayNote,
            }
          : undefined
      }
      notices={
        <LnurlPayPreviewNotices
          error={previewError}
          loading={previewLoading}
          preview={preview}
          t={t}
        />
      }
      onAmountChange={setLnAddressPayAmount}
      onSubmit={() => {
        if (invalid) return;
        void payLightningAddressWithCashu(
          lnAddress,
          amountSat,
          commentAllowed > 0 ? lnAddressPayNote.trim() || null : null,
          preview,
        );
      }}
      submitBusy={cashuIsBusy}
      submitDisabled={invalid}
      submitBlockedReason={submitBlockedReason}
      t={t}
    />
  );
};

export const LnAddressPayRoute: FC<
  Pick<LnAddressPayPageProps, "lnAddress">
> = ({ lnAddress }) => {
  const { payLightningAddressWithCashu } = useWalletCommands();
  const { knownLnAddressPayContact, knownLnAddressPayContactPictureUrl } =
    useKnownLnAddressPayContact("lnAddressPay");
  const draft = useLnAddressPayDraft();
  return (
    <LnAddressPayPage
      knownContact={knownLnAddressPayContact}
      knownContactPictureUrl={knownLnAddressPayContactPictureUrl}
      lnAddress={lnAddress}
      lnAddressPayAmount={draft.lnAddressPayAmount}
      lnAddressPayNote={draft.lnAddressPayNote}
      payLightningAddressWithCashu={payLightningAddressWithCashu}
      setLnAddressPayAmount={draft.setLnAddressPayAmount}
      setLnAddressPayNote={draft.setLnAddressPayNote}
    />
  );
};
