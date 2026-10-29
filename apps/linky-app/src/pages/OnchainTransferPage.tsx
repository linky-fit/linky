import {
  Button,
  Dialog,
  EmptyState,
  ListRow,
  Notice,
  Pressable,
  QRCode,
  Section,
  Stack,
  Text,
} from "@linky-fit/ui";
import {
  bitcoinPaymentUri,
  canUserCancel,
  explorerTxUrl,
} from "@linky-fit/onchain-transfer";
import type { OnchainTransferId } from "@linky-fit/linksync";
import React from "react";
import {
  useCopyText,
  useDisplayAmounts,
  useTranslation,
} from "../app/hooks/shell";
import {
  useOnchainConfig,
  useOnchainTransferCommands,
  useOnchainTransfers,
} from "../app/hooks/useOnchainTransfers";
import { useWalletBalance } from "../app/hooks/wallet/useWalletInventory";
import {
  ONCHAIN_TRANSFER_PHASE_LABEL_KEYS,
  ONCHAIN_TRANSFER_PHASE_TONES,
} from "../app/lib/onchainTransferLabels";
import {
  isOnchainSendUnpaid,
  type OnchainTransferView,
} from "../app/lib/onchainTransfers";
import { useExactAmountText } from "../app/hooks/useExactAmountText";
import type { Translate } from "../i18n";
import { openInBrowser } from "../platform/textShare";
import { groupAddress } from "../utils/formatting";

interface OnchainTransferDetailProps {
  transfer: OnchainTransferView;
  /** The config's explorer; null while the config is not known. */
  explorerUrl: string | null;
  /** Whether the wallet can pay an on-chain send's total, moving funds between mints included. */
  canPay: boolean;
  sendBusy: boolean;
  onCancel: () => void;
  onContactSupport: () => void;
  onCopy: (text: string) => void;
  onSend: () => void;
}

/** On-chain amounts the user moves themselves in sats, everything else in the display currency. */
type AmountText = ReturnType<typeof useExactAmountText> & {
  readonly display: (amountSat: number) => string;
};

/** What the phase means for the user, if the label alone does not say; the operator's reason replaces the hint of an ending it explains. */
const phaseHint = (
  transfer: OnchainTransferView,
  sendBusy: boolean,
  t: Translate,
  { btc, display, exact, sats }: AmountText,
): string | null => {
  const amount = display(transfer.amount);
  const reason = transfer.update?.reason?.trim() || null;
  switch (transfer.phase) {
    case "waitingForDetails":
      return transfer.direction === "send"
        ? t(sendBusy ? "onchainSendPayingHint" : "onchainSendUnpaidHint")
        : t("onchainTransferWaitingForDetailsHint");
    case "readyToSend":
      return t("onchainSendReadyHint");
    case "sent":
      return t("onchainSendSentHint").replace("{amount}", amount);
    case "awaitingDeposit":
      return t("onchainReceiveAwaitingDepositHint").replace(
        "{amount}",
        `${sats(transfer.sendAmount)} (${btc(transfer.sendAmount)})`,
      );
    // The deposit is being processed; what that takes was told before the address.
    case "depositSeen":
    case "depositConfirming":
      return null;
    case "shortDeposit": {
      const received = transfer.update?.receivedAmount ?? 0;
      return t("onchainReceiveShortDepositHint")
        .replace("{received}", exact(received))
        .replace("{missing}", exact(transfer.sendAmount - received))
        .replace("{total}", exact(transfer.sendAmount));
    }
    case "waitingForEcash":
      return t("onchainReceiveWaitingForEcashHint").replace("{amount}", amount);
    case "completed":
      return t(
        transfer.direction === "send"
          ? "onchainSendCompletedHint"
          : "onchainReceiveCompletedHint",
      ).replace("{amount}", amount);
    case "denied":
      return reason ?? t("onchainTransferDeniedHint");
    case "cancelled":
      return reason ?? t("onchainTransferCancelledHint");
    case "refunded":
      return reason ?? t("onchainTransferRefundedHint");
  }
};

/** Phases in which the money did not move as agreed, so the agreed amounts are only the original terms. */
const UNSUCCESSFUL_PHASES: ReadonlySet<OnchainTransferView["phase"]> = new Set([
  "denied",
  "cancelled",
  "refunded",
  "shortDeposit",
]);

/** What actually moved: what the operator got where it differs from the terms, what came back and, for a completed receive, what reached the balance. */
function MovedAmounts({
  transfer,
}: {
  transfer: OnchainTransferView;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { exact } = useExactAmountText();
  const { formatDisplayedAmountText } = useDisplayAmounts();
  const { direction, phase, update } = transfer;
  // A receive's deposit and refund moved on-chain; the rest is Cashu.
  const onchain = direction === "receive" ? exact : formatDisplayedAmountText;
  // A receive's deposit is what the user gets plus the fee, so it is only news when it fell short or came back.
  const received =
    direction === "send" || UNSUCCESSFUL_PHASES.has(phase)
      ? update?.receivedAmount
      : undefined;
  const refunded = phase === "refunded" ? update?.refundAmount : undefined;
  const credited =
    direction === "receive" && phase === "completed"
      ? transfer.amount
      : undefined;
  if (
    received === undefined &&
    refunded === undefined &&
    credited === undefined
  )
    return null;
  return (
    <Section>
      {received === undefined ? null : (
        <ListRow
          title={t(
            direction === "send"
              ? "onchainTransferPaid"
              : "onchainReceiveDeposited",
          )}
          value={onchain(received)}
          testID="onchain-transfer-received"
        />
      )}
      {refunded === undefined ? null : (
        <ListRow
          title={t("onchainTransferRefunded")}
          value={onchain(refunded)}
          testID="onchain-transfer-refunded"
        />
      )}
      {credited === undefined ? null : (
        <ListRow
          title={t("onchainReceiveAddedToBalance")}
          value={formatDisplayedAmountText(credited)}
          testID="onchain-transfer-credited"
        />
      )}
    </Section>
  );
}

/** Opens the transaction in the config's explorer, in the browser. */
function ExplorerLink({
  explorerUrl,
  label,
  txid,
}: {
  explorerUrl: string | null;
  label: string;
  txid: string | undefined;
}): React.ReactElement | null {
  if (txid === undefined || explorerUrl === null) return null;
  const url = explorerTxUrl(explorerUrl, txid);
  return (
    <ListRow
      icon="ArrowUpRight"
      title={label}
      chevron={false}
      onPress={() => openInBrowser(url)}
      testID="onchain-transfer-tx"
    />
  );
}

/** An address in groups of four, copied by a press. */
function CopyableAddress({
  address,
  onCopy,
  testID,
}: {
  address: string;
  onCopy: (text: string) => void;
  testID: string;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Pressable
      aria-label={t("copy")}
      alignSelf="center"
      onPress={() => onCopy(address)}
      testID={testID}
    >
      <Text mono textAlign="center" userSelect="text">
        {groupAddress(address)}
      </Text>
    </Pressable>
  );
}

/** The deposit address as a QR code and in groups of four, both copying it; a fixed amount's QR asks for the exact sats. */
function DepositInstructions({
  address,
  amount,
  onCopy,
}: {
  address: string;
  /** The exact sats to deposit; null for any amount. */
  amount: number | null;
  onCopy: (text: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const qrValue =
    amount === null ? address : bitcoinPaymentUri(address, amount);
  return (
    <Stack gap="$md" alignItems="center">
      <QRCode
        value={qrValue}
        accessibilityLabel={t("onchainReceiveDepositQr")}
        badge="Copy"
        onPress={() => onCopy(qrValue)}
        testID="onchain-transfer-deposit-qr"
      />
      <CopyableAddress
        address={address}
        onCopy={onCopy}
        testID="onchain-transfer-deposit-address"
      />
    </Stack>
  );
}

function PhaseStatus({
  transfer,
  canPay,
  sendBusy,
  onCopy,
  onSend,
}: Pick<
  OnchainTransferDetailProps,
  "transfer" | "canPay" | "sendBusy" | "onCopy" | "onSend"
>): React.ReactElement {
  const { t } = useTranslation();
  const amountText = {
    ...useExactAmountText(),
    display: useDisplayAmounts().formatDisplayedAmountText,
  };
  const { phase } = transfer;
  const hint = phaseHint(transfer, sendBusy, t, amountText);
  // The address of a receive of any amount speaks for itself; what to send was told before it.
  const addressOnly = phase === "awaitingDeposit" && transfer.anyAmount;
  return (
    <Stack gap="$md">
      {addressOnly ? null : (
        <Notice
          tone={ONCHAIN_TRANSFER_PHASE_TONES[phase]}
          title={t(ONCHAIN_TRANSFER_PHASE_LABEL_KEYS[phase])}
          description={hint ?? undefined}
        />
      )}
      {isOnchainSendUnpaid(transfer) ? (
        <Stack gap="$xs">
          <Button
            icon="Send"
            loading={sendBusy}
            disabled={!canPay}
            onPress={onSend}
            testID="onchain-transfer-send"
          >
            {t("onchainSendPay").replace(
              "{amount}",
              amountText.display(transfer.sendAmount),
            )}
          </Button>
          {canPay ? null : (
            <Text variant="caption" color="$colorMuted" textAlign="center">
              {t("payInsufficient")}
            </Text>
          )}
        </Stack>
      ) : null}
      {phase === "awaitingDeposit" && transfer.depositAddress !== null ? (
        <DepositInstructions
          address={transfer.depositAddress}
          amount={transfer.anyAmount ? null : transfer.sendAmount}
          onCopy={onCopy}
        />
      ) : null}
    </Stack>
  );
}

export function OnchainTransferDetail(
  props: OnchainTransferDetailProps,
): React.ReactElement {
  const {
    transfer,
    explorerUrl,
    sendBusy,
    onCancel,
    onContactSupport,
    onCopy,
  } = props;
  const { t } = useTranslation();
  const { exact } = useExactAmountText();
  const { formatDisplayedAmountText } = useDisplayAmounts();
  const [confirmingCancel, setConfirmingCancel] = React.useState(false);
  const { direction, phase, update } = transfer;
  const send = direction === "send";
  // A cancel reaching the operator before the ecash would strand the payment.
  const canCancel =
    canUserCancel(phase) && !(sendBusy && isOnchainSendUnpaid(transfer));
  // A receive of any amount has no terms until its deposit set them.
  const termsKnown =
    !transfer.anyAmount || update?.receivedAmount !== undefined;
  // What the user gets, in sats beside the display currency for a receive, whose deposit was on-chain.
  const amountText = send ? formatDisplayedAmountText : exact;
  return (
    <Stack gap="$lg">
      <PhaseStatus {...props} />
      <MovedAmounts transfer={transfer} />
      {termsKnown ? (
        // The fee was explained before the transfer; only what arrives matters now.
        <Section
          title={
            UNSUCCESSFUL_PHASES.has(phase)
              ? t("onchainTransferOriginalTerms")
              : undefined
          }
        >
          <ListRow
            title={t("onchainTransferYouGet")}
            value={amountText(transfer.amount)}
            testID="onchain-transfer-amount"
          />
        </Section>
      ) : null}
      {send && transfer.payoutAddress !== null ? (
        <CopyableAddress
          address={transfer.payoutAddress}
          onCopy={onCopy}
          testID="onchain-transfer-payout-address"
        />
      ) : null}
      <ExplorerLink
        explorerUrl={explorerUrl}
        label={t("onchainTransferViewTransaction")}
        txid={update?.txid}
      />
      <ExplorerLink
        explorerUrl={explorerUrl}
        label={t("onchainTransferViewRefund")}
        txid={update?.refundTxid}
      />
      {canCancel ? (
        <Button
          variant="secondary"
          icon="X"
          onPress={() => setConfirmingCancel(true)}
          testID="onchain-transfer-cancel"
        >
          {t("onchainTransferCancel")}
        </Button>
      ) : null}
      {UNSUCCESSFUL_PHASES.has(phase) ? (
        <ListRow
          icon="MessageCircle"
          title={t("onchainTransferContactSupport")}
          onPress={onContactSupport}
          testID="onchain-transfer-support"
        />
      ) : null}
      {confirmingCancel ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirmingCancel(false);
          }}
          title={t("onchainTransferCancelTitle")}
          description={t("onchainTransferCancelBody")}
          actions={
            <>
              <Button
                variant="danger"
                onPress={() => {
                  setConfirmingCancel(false);
                  onCancel();
                }}
                testID="onchain-transfer-cancel-confirm"
              >
                {t("onchainTransferCancel")}
              </Button>
              <Button
                variant="secondary"
                onPress={() => setConfirmingCancel(false)}
              >
                {t("onchainTransferKeep")}
              </Button>
            </>
          }
        />
      ) : null}
    </Stack>
  );
}

export function OnchainTransferPage({
  id,
}: {
  id: OnchainTransferId;
}): React.ReactElement {
  const { t } = useTranslation();
  const copyText = useCopyText();
  const configState = useOnchainConfig();
  const transfers = useOnchainTransfers();
  const { cashuBalanceAfterMelt, cashuIsBusy } = useWalletBalance();
  const { cancelOnchainTransfer, contactSupport, sendOnchainTransferPayment } =
    useOnchainTransferCommands();
  const transfer = transfers.find((candidate) => candidate.id === id) ?? null;
  if (transfer === null) {
    return <EmptyState title={t("onchainTransferNotFound")} />;
  }
  const config = configState.status === "ready" ? configState.config : null;
  return (
    <OnchainTransferDetail
      transfer={transfer}
      explorerUrl={config?.explorerUrl ?? null}
      canPay={transfer.sendAmount <= cashuBalanceAfterMelt}
      sendBusy={cashuIsBusy}
      onCancel={() => void cancelOnchainTransfer(transfer)}
      onContactSupport={() => contactSupport(transfer.id)}
      onCopy={(text) => void copyText(text)}
      onSend={() => {
        if (config !== null) sendOnchainTransferPayment(transfer, config);
      }}
    />
  );
}
