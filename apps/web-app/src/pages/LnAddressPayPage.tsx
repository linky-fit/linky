import { Avatar, Button, Row, Stack, Text } from "@linky-fit/ui";
import { useEffect, type FC } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { LnurlPayPreviewNotices } from "../components/LnurlPayPreviewNotices";
import { PaymentAmountPanel } from "../components/PaymentAmountPanel";
import {
  getLnurlPayAmountRangeError,
  useLnurlPayPreview,
} from "../hooks/useLnurlPayPreview";
import {
  getLnurlPayDisplayText,
  inferLightningAddressFromLnurlTarget,
} from "../lnurlPay";
import { navigateTo } from "../hooks/useRouting";
import { formatMiddleDots } from "../utils/formatting";

interface LnAddressPayKnownContact {
  lnAddress?: string | null;
  name?: string | null;
}

interface LnAddressPayPageProps {
  canPayWithCashu: boolean;
  cashuBalance: number;
  cashuBalanceAfterMelt: number;
  cashuIsBusy: boolean;
  displayUnit: string;
  knownContact: LnAddressPayKnownContact | null;
  knownContactPictureUrl: string | null;
  lnAddress: string;
  lnAddressPayAmount: string;
  lnAddressPayNote: string;
  payLightningAddressWithCashu: (
    lnAddress: string,
    amountSat: number,
    comment: string | null,
  ) => Promise<void>;
  setLnAddressPayAmount: (value: string | ((prev: string) => string)) => void;
  setLnAddressPayNote: (value: string) => void;
}

export const LnAddressPayPage: FC<LnAddressPayPageProps> = ({
  canPayWithCashu,
  cashuBalance,
  cashuBalanceAfterMelt,
  cashuIsBusy,
  knownContact,
  knownContactPictureUrl,
  lnAddress,
  lnAddressPayAmount,
  lnAddressPayNote,
  payLightningAddressWithCashu,
  setLnAddressPayAmount,
  setLnAddressPayNote,
}) => {
  const { formatDisplayedAmountText, t } = useAppShellCore();
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

  const submitBlockedReason =
    amountSat > cashuBalanceAfterMelt
      ? t("payInsufficient")
      : (rangeError ?? undefined);

  return (
    <PaymentAmountPanel
      amount={lnAddressPayAmount}
      cashuIsBusy={cashuIsBusy || previewLoading}
      header={
        <Row>
          {knownContact ? (
            <Avatar
              name={knownContact.name ?? ""}
              uri={knownContactPictureUrl ?? undefined}
              size="md"
            />
          ) : null}
          <Stack flex={1} gap="$xxs">
            {knownContact?.name ? (
              <Text variant="title" numberOfLines={1}>
                {knownContact.name}
              </Text>
            ) : null}
            <Text color="$colorMuted">{displayAddress}</Text>
            <Button
              variant="ghost"
              size="sm"
              alignSelf="flex-start"
              disabled={!canCoverAnything}
              onPress={() => setLnAddressPayAmount(String(cashuBalance))}
            >
              {availableAmountText}
            </Button>
          </Stack>
        </Row>
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
      footer={
        <Button
          variant="ghost"
          size="sm"
          onPress={() =>
            navigateTo({
              route: "recurringPaymentNew",
              prefill: {
                lnAddress:
                  knownContact?.lnAddress ??
                  preview?.lightningAddress ??
                  inferredLightningAddress ??
                  lnAddress,
                ...(Number.isFinite(amountSat) && amountSat > 0
                  ? { amountSat }
                  : {}),
              },
            })
          }
        >
          {t("recurringRepeatPayment")}
        </Button>
      }
      onAmountChange={setLnAddressPayAmount}
      onSubmit={() => {
        if (invalid) return;
        void payLightningAddressWithCashu(
          lnAddress,
          amountSat,
          commentAllowed > 0 ? lnAddressPayNote.trim() || null : null,
        );
      }}
      submitBusy={cashuIsBusy}
      submitDisabled={invalid}
      submitBlockedReason={submitBlockedReason}
      t={t}
    />
  );
};
