import type { OnchainTransferId } from "@linky-fit/domain";
import {
  bitcoinPaymentUri,
  explorerAddressUrl,
  explorerTxUrl,
  REQUIRED_CONFIRMATIONS,
} from "@linky-fit/onchain-transfer";
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  Notice,
  QRCode,
  Row,
  Stack,
  Text,
  TextField,
  TopBar,
} from "@linky-fit/ui";
import { useState, type ReactNode } from "react";
import { copy } from "../copy/en";
import {
  ecashRefundAmount,
  receivedMismatch,
  sharedDepositAddresses,
  transferConcern,
} from "../domain/rules";
import {
  isAnyAmountReceive,
  transferStatus,
  transferTerms,
  type OperatorTransfer,
} from "../domain/transfer";
import { encodeNpub } from "@linky-fit/linkstr";
import { formatDateTime, formatSats } from "../format";
import { navigateTo } from "../platform/hashRoute";
import { chatRoute, sectionRoute } from "../routing";
import { useAppServices, useProfile, useTransfers } from "../services/react";
import type { TransferActionFailure } from "../services/transfers";
import { Page, WithTopBar } from "./Page";
import { TransferField } from "./TransferField";
import { transferTitle } from "./labels";
import { StatusPill } from "./TransferParts";
import { PeerSummary } from "./Peer";

/** Runs one action at a time and shows why the last one did nothing. */
const useAction = () => {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (
    name: string,
    action: () => Promise<TransferActionFailure | null>,
  ): Promise<boolean> => {
    if (busy !== null) return false;
    setBusy(name);
    setError(null);
    try {
      const failure = await action();
      if (failure !== null) setError(copy.failure(failure));
      return failure === null;
    } catch (caught) {
      console.warn("[onchain-operator] transfer action failed", caught);
      setError(copy.actionFailed);
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run };
};

type Action = ReturnType<typeof useAction>;

export function TransferDetailScreen({
  transferId,
}: {
  readonly transferId: OnchainTransferId;
}) {
  const transfers = useTransfers() ?? [];
  const transfer = transfers.find((candidate) => candidate.id === transferId);
  return (
    <WithTopBar
      topBar={
        <TopBar
          title={copy.transfer.title}
          leading={
            <IconButton
              icon="ArrowLeft"
              accessibilityLabel={copy.back}
              onPress={() => navigateTo(sectionRoute("transfers"))}
            />
          }
        />
      }
    >
      <Page testID="transfer-detail">
        {transfer === undefined ? (
          <EmptyState icon="Repeat" title={copy.transfer.notFound} />
        ) : (
          <TransferDetail
            transfer={transfer}
            sharedAddress={
              transfer.depositAddress !== null &&
              sharedDepositAddresses(transfers).has(transfer.depositAddress)
            }
          />
        )}
      </Page>
    </WithTopBar>
  );
}

function TransferDetail({
  transfer,
  sharedAddress,
}: {
  readonly transfer: OperatorTransfer;
  /** Whether another transfer holds the same deposit address. */
  readonly sharedAddress: boolean;
}) {
  const { config } = useAppServices();
  const profile = useProfile() ?? null;
  const action = useAction();
  const { amount, fee, sendAmount } = transferTerms(transfer);
  const update = transfer.update;
  // Before the deposit, a receive of any amount holds the minimum's terms, not what the user gets.
  const depositPending =
    isAnyAmountReceive(transfer) && update?.receivedAmount === undefined;
  const txUrl = (txid: string) => explorerTxUrl(config.explorerUrl, txid);
  return (
    <Stack gap="$lg">
      <Row justifyContent="space-between">
        <Text variant="title">{transferTitle(transfer)}</Text>
        <StatusPill transfer={transfer} />
      </Row>
      <Card gap="$md">
        <TransferField
          label={copy.transfer.amount}
          value={formatSats(sendAmount)}
        />
        <TransferField
          label={copy.transfer.fee}
          value={`${formatSats(fee)} (${transfer.feeBasisPoints / 100} %)`}
        />
        <TransferField
          label={copy.transfer.receive}
          value={
            depositPending && profile !== null
              ? copy.transfer.anyAmount(
                  formatSats(profile.minReceiveAmount),
                  formatSats(profile.maxReceiveAmount),
                )
              : formatSats(amount)
          }
        />
        <TransferField
          label={copy.transfer.requestedAt}
          value={formatDateTime(transfer.createdAtSec)}
        />
        <Stack gap="$xxs">
          <Text variant="caption" color="$colorMuted">
            {copy.transfer.user}
          </Text>
          <Row justifyContent="space-between" gap="$sm">
            <PeerSummary pubkey={transfer.user} />
            <Button
              size="sm"
              variant="secondary"
              icon="MessageCircle"
              onPress={() => navigateTo(chatRoute(transfer.user))}
            >
              {copy.transfer.openChat}
            </Button>
          </Row>
        </Stack>
        <TransferField
          label={copy.transfer.userNpub}
          value={encodeNpub(transfer.user)}
        />
        {transfer.payoutAddress === null ? null : (
          <TransferField
            label={copy.transfer.payoutAddress}
            value={transfer.payoutAddress}
          />
        )}
        {transfer.depositAddress === null ? null : (
          <TransferField
            label={`${copy.transfer.depositAddress} · ${copy.transfer.addressIndex(transfer.addressIndex ?? 0)}`}
            value={transfer.depositAddress}
            href={explorerAddressUrl(
              config.explorerUrl,
              transfer.depositAddress,
            )}
          />
        )}
        {transfer.refund === null ? null : (
          <TransferField
            label={copy.transfer.refund}
            value={
              transfer.refund.to === "sender"
                ? copy.transfer.refundToSender
                : copy.transfer.refundToAddress(transfer.refund.address)
            }
          />
        )}
        {update?.receivedAmount === undefined ? null : (
          <TransferField
            label={copy.transfer.received}
            value={formatSats(update.receivedAmount)}
          />
        )}
        {update?.confirmations === undefined ? null : (
          <TransferField
            label={copy.transfer.confirmations(
              update.confirmations,
              REQUIRED_CONFIRMATIONS,
            )}
            value={update.txid ?? ""}
            href={update.txid === undefined ? undefined : txUrl(update.txid)}
          />
        )}
        {transfer.direction === "send" && update?.txid !== undefined ? (
          <TransferField
            label={copy.transfer.payoutTx}
            value={update.txid}
            href={txUrl(update.txid)}
          />
        ) : null}
        {update?.refundTxid === undefined ? null : (
          <TransferField
            label={copy.transfer.refundTx}
            value={update.refundTxid}
            href={txUrl(update.refundTxid)}
          />
        )}
        {update?.reason === undefined ? null : (
          <TransferField label={copy.transfer.reason} value={update.reason} />
        )}
      </Card>
      <Warnings
        transfer={transfer}
        sharedAddress={sharedAddress}
        concern={transferConcern(transfer, { ...config, profile })}
      />
      <Steps transfer={transfer} action={action} />
      {action.error === null ? null : (
        <Notice tone="danger" icon="CircleAlert" title={action.error} />
      )}
    </Stack>
  );
}

function Warnings({
  transfer,
  sharedAddress,
  concern,
}: {
  readonly transfer: OperatorTransfer;
  readonly sharedAddress: boolean;
  /** Why the send would have been denied; sends are accepted on arrival and refunded instead. */
  readonly concern: string | null;
}) {
  const { transfers } = useAppServices();
  const mismatch = receivedMismatch(transfer);
  const received = formatSats(transfer.update?.receivedAmount ?? 0);
  const sendAmount = formatSats(transferTerms(transfer).sendAmount);
  const status = transferStatus(transfer);
  const earlyEcash =
    transfer.direction === "send" && status === "accepted"
      ? transfers.earlyEcash(transfer.id)
      : null;
  return (
    <>
      {concern === null ? null : (
        <Notice
          tone="warning"
          icon="TriangleAlert"
          title={copy.transfer.concern(
            concern,
            status === "fundsReceived" || status === "refunded",
          )}
        />
      )}
      {earlyEcash === null ? null : (
        <Notice
          tone="info"
          icon="Coins"
          title={copy.transfer.earlyEcashShort(
            formatSats(earlyEcash),
            sendAmount,
          )}
        />
      )}
      {sharedAddress ? (
        <Notice
          tone="danger"
          icon="TriangleAlert"
          title={copy.transfer.sharedAddress}
        />
      ) : null}
      {transfer.userCancelledAtSec === null ? null : (
        <Notice
          tone="warning"
          icon="TriangleAlert"
          title={copy.transfer.userCancelled(
            formatDateTime(transfer.userCancelledAtSec),
          )}
          description={
            status === "fundsSeen" || status === "fundsReceived"
              ? copy.transfer.userCancelledFundsMoved
              : undefined
          }
        />
      )}
      {transfer.direction === "receive" && mismatch === "short" ? (
        <Notice
          tone="danger"
          icon="TriangleAlert"
          title={copy.transfer.short(received, sendAmount)}
        />
      ) : null}
      {transfer.direction === "receive" && mismatch === "extra" ? (
        <Notice
          tone="warning"
          icon="TriangleAlert"
          title={copy.transfer.extra(received, sendAmount)}
        />
      ) : null}
    </>
  );
}

/** What the operator can do next, by direction and status. */
function Steps({
  transfer,
  action,
}: {
  readonly transfer: OperatorTransfer;
  readonly action: Action;
}) {
  const { transfers } = useAppServices();
  const status = transferStatus(transfer);
  const received = ecashRefundAmount(transfer);
  const inFlight = status === "fundsReceived" && transfer.ecashSendId !== null;
  const steps: ReactNode[] = [];

  if (inFlight) {
    steps.push(
      <Notice
        key="in-flight"
        tone="info"
        icon="Send"
        title={copy.failure({ reason: "inFlight" })}
        description={copy.transfer.ecashInFlightHint}
        action={{
          label: copy.transfer.takeBackEcash,
          onPress: () =>
            void action.run("takeBackEcash", () =>
              transfers.takeBackEcash(transfer.id),
            ),
        }}
      />,
    );
  }
  if (status === null) {
    steps.push(
      <Decide
        key="decide"
        action={action}
        primary={{
          label: copy.transfer.accept,
          run: () => transfers.accept(transfer.id),
        }}
        secondary={{
          label: copy.transfer.deny,
          run: (reason) => transfers.deny(transfer.id, reason),
        }}
      />,
    );
  }
  if (transfer.direction === "send" && status === "accepted") {
    steps.push(
      <Text key="waiting" color="$colorMuted">
        {copy.transfer.waitingForEcash}
      </Text>,
    );
  }
  if (
    transfer.direction === "send" &&
    status === "fundsReceived" &&
    transfer.payoutAddress !== null &&
    !inFlight
  ) {
    steps.push(
      <Card key="payout" gap="$md" outlined>
        <Text variant="title">{copy.transfer.payoutTitle}</Text>
        <Text color="$colorMuted">
          {copy.transfer.payoutDescription(
            formatSats(transferTerms(transfer).amount),
          )}
        </Text>
        <Stack alignItems="center">
          <QRCode
            value={bitcoinPaymentUri(
              transfer.payoutAddress,
              transferTerms(transfer).amount,
            )}
            accessibilityLabel={copy.transfer.payoutQr}
          />
        </Stack>
        <TxidStep
          action={action}
          label={copy.transfer.confirmPayout}
          run={(txid) => transfers.confirmPayout(transfer.id, txid)}
        />
      </Card>,
      <Stack key="refund-ecash" gap="$xs">
        <Button
          variant="secondary"
          icon="ArrowDownRight"
          loading={action.busy === "refundEcash"}
          onPress={() =>
            void action.run("refundEcash", () =>
              transfers.refundEcash(transfer.id),
            )
          }
        >
          {copy.transfer.refundEcash(formatSats(received))}
        </Button>
        <Text variant="caption" color="$colorMuted">
          {copy.transfer.refundEcashHint}
        </Text>
      </Stack>,
    );
  }
  if (
    transfer.direction === "receive" &&
    (status === "accepted" || status === "fundsSeen")
  ) {
    steps.push(
      <Row key="watch" justifyContent="space-between">
        <Text color="$colorMuted" flex={1}>
          {copy.transfer.waitingForDeposit}
        </Text>
        <Button
          size="sm"
          variant="secondary"
          icon="RefreshCcw"
          loading={action.busy === "check"}
          onPress={() =>
            void action.run("check", async () => {
              await transfers.checkDeposits();
              return null;
            })
          }
        >
          {copy.transfer.checkNow}
        </Button>
      </Row>,
    );
  }
  if (
    transfer.direction === "receive" &&
    status === "fundsReceived" &&
    !inFlight
  ) {
    steps.push(
      <Stack key="send-ecash" gap="$xs">
        <Button
          icon="Send"
          disabled={receivedMismatch(transfer) === "short"}
          loading={action.busy === "sendEcash"}
          onPress={() =>
            void action.run("sendEcash", () => transfers.sendEcash(transfer.id))
          }
        >
          {copy.transfer.sendEcash(formatSats(transferTerms(transfer).amount))}
        </Button>
        <Text variant="caption" color="$colorMuted">
          {copy.transfer.sendEcashHint}
        </Text>
      </Stack>,
    );
  }
  if (
    transfer.direction === "receive" &&
    (status === "fundsSeen" || status === "fundsReceived") &&
    !inFlight
  ) {
    steps.push(
      <Card key="refund" gap="$md" outlined>
        <Text variant="title">{copy.transfer.refundTitle}</Text>
        <Text color="$colorMuted">{copy.transfer.refundDescription}</Text>
        <TxidStep
          action={action}
          label={copy.transfer.confirmRefund}
          run={(txid) => transfers.confirmRefund(transfer.id, txid)}
        />
      </Card>,
    );
  }
  if (status === "accepted" || status === "fundsSeen") {
    steps.push(
      <Decide
        key="cancel"
        action={action}
        secondary={{
          label: copy.transfer.cancel,
          run: (reason) => transfers.cancel(transfer.id, reason),
        }}
      />,
    );
  }
  return <Stack gap="$lg">{steps}</Stack>;
}

/** Accept, or deny and cancel with an optional reason for the user. */
function Decide({
  action,
  primary,
  secondary,
}: {
  readonly action: Action;
  readonly primary?: {
    readonly label: string;
    readonly run: () => Promise<TransferActionFailure | null>;
  };
  readonly secondary: {
    readonly label: string;
    readonly run: (reason: string) => Promise<TransferActionFailure | null>;
  };
}) {
  const [reason, setReason] = useState("");
  return (
    <Stack gap="$md">
      {primary === undefined ? null : (
        <Button
          icon="Check"
          loading={action.busy === primary.label}
          onPress={() => void action.run(primary.label, primary.run)}
        >
          {primary.label}
        </Button>
      )}
      <TextField
        label={copy.transfer.reasonField}
        value={reason}
        maxLength={500}
        onChangeText={setReason}
      />
      <Button
        variant="secondary"
        icon="Ban"
        loading={action.busy === secondary.label}
        onPress={() =>
          void action.run(secondary.label, () => secondary.run(reason))
        }
      >
        {secondary.label}
      </Button>
    </Stack>
  );
}

/** A transaction id field and the button that confirms it. */
function TxidStep({
  action,
  label,
  run,
}: {
  readonly action: Action;
  readonly label: string;
  readonly run: (txid: string) => Promise<TransferActionFailure | null>;
}) {
  const [txid, setTxid] = useState("");
  return (
    <Stack gap="$md">
      <TextField
        label={copy.transfer.txidField}
        value={txid}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        onChangeText={setTxid}
      />
      <Button
        icon="Check"
        disabled={txid.trim() === ""}
        loading={action.busy === label}
        onPress={() => void action.run(label, () => run(txid))}
      >
        {label}
      </Button>
    </Stack>
  );
}
