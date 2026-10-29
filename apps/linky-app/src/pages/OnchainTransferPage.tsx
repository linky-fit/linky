import {
  Button,
  Dialog,
  EmptyState,
  Icon,
  ListRow,
  Notice,
  QRCode,
  Section,
  Stack,
  Text,
  TextLink,
} from "@linky-fit/ui";
import {
  bitcoinPaymentUri,
  canUserCancel,
  explorerTxUrl,
  type OnchainConfig,
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
  ONCHAIN_TRANSFER_TITLE_KEYS,
} from "../app/lib/onchainTransferLabels";
import {
  isOnchainSendUnpaid,
  type OnchainTransferView,
} from "../app/lib/onchainTransfers";
import { OnchainTransferAmounts } from "../components/OnchainTransfer";
import { useExactAmountText } from "../app/hooks/useExactAmountText";
import type { Translate } from "../i18n";
import { formatMiddleDots } from "../utils/formatting";

/** The least and the most a receive of any amount is made for, from the config. */
export interface OnchainReceiveLimits {
  readonly min: number;
  readonly max: number;
}

interface OnchainTransferDetailProps {
  transfer: OnchainTransferView;
  /** The config's explorer; null while the config is not known. */
  explorerUrl: string | null;
  /** The config's receive limits; null while the config is not known. */
  receiveLimits: OnchainReceiveLimits | null;
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

/** What the phase means for the user; the operator's reason replaces the hint of an ending it explains. */
const phaseHint = (
  transfer: OnchainTransferView,
  limits: OnchainReceiveLimits | null,
  sendBusy: boolean,
  t: Translate,
  { btc, display, exact, sats }: AmountText,
): string => {
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
      if (!transfer.anyAmount)
        return t("onchainReceiveAwaitingDepositHint").replace(
          "{amount}",
          `${sats(transfer.sendAmount)} (${btc(transfer.sendAmount)})`,
        );
      return limits === null
        ? t("onchainReceiveAnyAmountHint")
        : t("onchainReceiveAnyAmountLimitsHint")
            .replace("{min}", sats(limits.min))
            .replace("{max}", sats(limits.max));
    case "depositSeen":
      return t("onchainReceiveDepositSeenHint");
    case "depositConfirming":
      return t("onchainReceiveDepositConfirmingHint");
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

/** What actually moved: what the operator got, what came back and, for a completed receive, what reached the balance. */
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
  const received = update?.receivedAmount;
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

function TransactionRow({
  explorerUrl,
  label,
  txid,
}: {
  explorerUrl: string | null;
  label: string;
  txid: string | undefined;
}): React.ReactElement | null {
  if (txid === undefined) return null;
  const shortTxid = formatMiddleDots(txid, 20);
  return (
    <ListRow
      title={label}
      description={
        explorerUrl === null ? (
          <Text mono>{shortTxid}</Text>
        ) : (
          <TextLink href={explorerTxUrl(explorerUrl, txid)}>
            {shortTxid}
          </TextLink>
        )
      }
      testID="onchain-transfer-tx"
    />
  );
}

function AddressRow({
  label,
  address,
  onCopy,
}: {
  label: string;
  address: string;
  onCopy: (text: string) => void;
}): React.ReactElement {
  return (
    <ListRow
      title={label}
      description={
        <Text mono userSelect="text">
          {address}
        </Text>
      }
      trailing={<Icon name="Copy" size="sm" color="$colorMuted" />}
      chevron={false}
      onPress={() => onCopy(address)}
    />
  );
}

/** The deposit address as a QR code: bare for a receive of any amount, with the exact sats a fixed one must match. */
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
      <Stack alignSelf="stretch" gap="$sm">
        <ListRow
          title={t("onchainTransferDepositAddress")}
          description={
            <Text mono userSelect="text">
              {address}
            </Text>
          }
        />
        {amount === null ? null : (
          <Button
            variant="secondary"
            icon="Copy"
            onPress={() => onCopy(qrValue)}
            testID="onchain-transfer-copy-payment"
          >
            {t("onchainReceiveCopyPaymentDetails")}
          </Button>
        )}
        <Button
          variant="secondary"
          icon="Copy"
          onPress={() => onCopy(address)}
          testID="onchain-transfer-copy-address"
        >
          {t("onchainReceiveCopyAddress")}
        </Button>
      </Stack>
    </Stack>
  );
}

function PhaseStatus({
  transfer,
  receiveLimits,
  canPay,
  sendBusy,
  onCopy,
  onSend,
}: Pick<
  OnchainTransferDetailProps,
  "transfer" | "receiveLimits" | "canPay" | "sendBusy" | "onCopy" | "onSend"
>): React.ReactElement {
  const { t } = useTranslation();
  const amountText = {
    ...useExactAmountText(),
    display: useDisplayAmounts().formatDisplayedAmountText,
  };
  const { phase } = transfer;
  return (
    <Stack gap="$md">
      <Notice
        tone={ONCHAIN_TRANSFER_PHASE_TONES[phase]}
        title={t(ONCHAIN_TRANSFER_PHASE_LABEL_KEYS[phase])}
        description={phaseHint(
          transfer,
          receiveLimits,
          sendBusy,
          t,
          amountText,
        )}
      />
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
  const [confirmingCancel, setConfirmingCancel] = React.useState(false);
  const { direction, phase, update } = transfer;
  const send = direction === "send";
  // A cancel reaching the operator before the ecash would strand the payment.
  const canCancel =
    canUserCancel(phase) && !(sendBusy && isOnchainSendUnpaid(transfer));
  // A receive of any amount has no terms until its deposit set them.
  const termsKnown =
    !transfer.anyAmount || update?.receivedAmount !== undefined;
  return (
    <Stack gap="$lg">
      <Text variant="title">{t(ONCHAIN_TRANSFER_TITLE_KEYS[direction])}</Text>
      <PhaseStatus {...props} />
      <MovedAmounts transfer={transfer} />
      {termsKnown ? (
        <OnchainTransferAmounts
          title={
            UNSUCCESSFUL_PHASES.has(phase)
              ? t("onchainTransferOriginalTerms")
              : undefined
          }
          direction={direction}
          amount={transfer.amount}
          fee={transfer.fee}
          total={transfer.sendAmount}
          feePercent={null}
          showTotal={!transfer.anyAmount}
        />
      ) : null}
      <Section>
        {send && transfer.payoutAddress !== null ? (
          <AddressRow
            label={t("onchainTransferPayoutAddress")}
            address={transfer.payoutAddress}
            onCopy={onCopy}
          />
        ) : null}
        {!send &&
        transfer.depositAddress !== null &&
        phase !== "awaitingDeposit" ? (
          <AddressRow
            label={t("onchainTransferDepositAddress")}
            address={transfer.depositAddress}
            onCopy={onCopy}
          />
        ) : null}
        <TransactionRow
          explorerUrl={explorerUrl}
          label={t(
            send
              ? "onchainTransferPayoutTransaction"
              : "onchainTransferDepositTransaction",
          )}
          txid={update?.txid}
        />
        <TransactionRow
          explorerUrl={explorerUrl}
          label={t("onchainTransferRefundTransaction")}
          txid={update?.refundTxid}
        />
      </Section>
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
      <ListRow
        icon="MessageCircle"
        title={t("onchainTransferContactSupport")}
        onPress={onContactSupport}
        testID="onchain-transfer-support"
      />
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

const receiveLimitsOf = (config: OnchainConfig): OnchainReceiveLimits | null =>
  config.minReceiveAmount === undefined
    ? null
    : { min: config.minReceiveAmount, max: config.maxReceiveAmount };

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
      receiveLimits={config === null ? null : receiveLimitsOf(config)}
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
