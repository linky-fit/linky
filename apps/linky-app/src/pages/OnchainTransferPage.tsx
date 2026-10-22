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
  REQUIRED_CONFIRMATIONS,
} from "@linky-fit/onchain-transfer";
import type { OnchainTransferId } from "@linky-fit/linksync";
import React from "react";
import { useCopyText, useTranslation } from "../app/hooks/shell";
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
import type { OnchainTransferView } from "../app/lib/onchainTransfers";
import { OnchainTransferAmounts } from "../components/OnchainTransfer";
import { useExactAmountText } from "../app/hooks/useExactAmountText";
import type { Translate } from "../i18n";
import { formatMiddleDots } from "../utils/formatting";

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

type AmountText = ReturnType<typeof useExactAmountText>;

/** What the phase means for the user; the operator's reason replaces the hint of an ending it explains. */
const phaseHint = (
  transfer: OnchainTransferView,
  t: Translate,
  { btc, exact, sats }: AmountText,
): string => {
  const amount = exact(transfer.amount);
  const reason = transfer.update?.reason?.trim() || null;
  switch (transfer.phase) {
    case "waitingForDetails":
      return t("onchainTransferWaitingForDetailsHint");
    case "readyToSend":
      return t("onchainSendReadyHint");
    case "sent":
      return t("onchainSendSentHint").replace("{amount}", amount);
    case "awaitingDeposit":
      return t("onchainReceiveAwaitingDepositHint").replace(
        "{amount}",
        `${sats(transfer.sendAmount)} (${btc(transfer.sendAmount)})`,
      );
    case "depositSeen":
      return t("onchainReceiveDepositSeenHint").replace(
        "{required}",
        String(REQUIRED_CONFIRMATIONS),
      );
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
  const { direction, phase, update } = transfer;
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
          value={exact(received)}
          testID="onchain-transfer-received"
        />
      )}
      {refunded === undefined ? null : (
        <ListRow
          title={t("onchainTransferRefunded")}
          value={exact(refunded)}
          testID="onchain-transfer-refunded"
        />
      )}
      {credited === undefined ? null : (
        <ListRow
          title={t("onchainReceiveAddedToBalance")}
          value={exact(credited)}
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

/** The QR and "Copy payment details" carry the exact sats, which an on-chain payment must match. */
function DepositInstructions({
  address,
  amount,
  onCopy,
}: {
  address: string;
  amount: number;
  onCopy: (text: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const paymentUri = bitcoinPaymentUri(address, amount);
  return (
    <Stack gap="$md" alignItems="center">
      <QRCode
        value={paymentUri}
        accessibilityLabel={t("onchainReceiveDepositQr")}
        badge="Copy"
        onPress={() => onCopy(paymentUri)}
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
        <Button
          variant="secondary"
          icon="Copy"
          onPress={() => onCopy(paymentUri)}
          testID="onchain-transfer-copy-payment"
        >
          {t("onchainReceiveCopyPaymentDetails")}
        </Button>
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
  canPay,
  sendBusy,
  onCopy,
  onSend,
}: Pick<
  OnchainTransferDetailProps,
  "transfer" | "canPay" | "sendBusy" | "onCopy" | "onSend"
>): React.ReactElement {
  const { t } = useTranslation();
  const amountText = useExactAmountText();
  const { phase, update } = transfer;
  const title =
    phase === "depositSeen"
      ? t("onchainReceiveConfirmations")
          .replace("{count}", String(update?.confirmations ?? 0))
          .replace("{required}", String(REQUIRED_CONFIRMATIONS))
      : t(ONCHAIN_TRANSFER_PHASE_LABEL_KEYS[phase]);
  return (
    <Stack gap="$md">
      <Notice
        tone={ONCHAIN_TRANSFER_PHASE_TONES[phase]}
        title={title}
        description={phaseHint(transfer, t, amountText)}
      />
      {phase === "readyToSend" ? (
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
              amountText.exact(transfer.sendAmount),
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
          amount={transfer.sendAmount}
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
    canUserCancel(phase) && !(sendBusy && phase === "readyToSend");
  return (
    <Stack gap="$lg">
      <Text variant="title">{t(ONCHAIN_TRANSFER_TITLE_KEYS[direction])}</Text>
      <PhaseStatus {...props} />
      <MovedAmounts transfer={transfer} />
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
      />
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
        {send ? null : transfer.refundToSender ||
          transfer.refundAddress === null ? (
          <ListRow
            title={t("onchainTransferRefundAddress")}
            description={t("onchainTransferRefundToSender")}
          />
        ) : (
          <AddressRow
            label={t("onchainTransferRefundAddress")}
            address={transfer.refundAddress}
            onCopy={onCopy}
          />
        )}
        {!send && update?.confirmations !== undefined ? (
          <ListRow
            title={t("onchainTransferConfirmationsLabel")}
            value={`${update.confirmations}/${REQUIRED_CONFIRMATIONS}`}
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
  return (
    <OnchainTransferDetail
      transfer={transfer}
      explorerUrl={
        configState.status === "ready" ? configState.config.explorerUrl : null
      }
      canPay={transfer.sendAmount <= cashuBalanceAfterMelt}
      sendBusy={cashuIsBusy}
      onCancel={() => void cancelOnchainTransfer(transfer)}
      onContactSupport={() => contactSupport(transfer.id)}
      onCopy={(text) => void copyText(text)}
      onSend={() => sendOnchainTransferPayment(transfer)}
    />
  );
}
