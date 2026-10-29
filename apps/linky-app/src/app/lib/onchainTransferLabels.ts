import type {
  OnchainTransferDirection,
  OnchainTransferPhase,
} from "@linky-fit/onchain-transfer";
import type { IconName, Tone } from "@linky-fit/ui";
import type { I18nKey } from "../../i18n";
import { normalizeLocale } from "../../utils/formatting";
import type { OnchainTransferView } from "./onchainTransfers";

/** What the user starts: "Send to on-chain wallet", "Receive from on-chain wallet". */
export const ONCHAIN_TRANSFER_TITLE_KEYS: Record<
  OnchainTransferDirection,
  I18nKey
> = {
  send: "onchainSendTitle",
  receive: "onchainReceiveTitle",
};

/** A transfer's title in the payment history, short so it fits a phone; its phase shows beside it. */
export const ONCHAIN_TRANSFER_HISTORY_TITLE_KEYS: Record<
  OnchainTransferDirection,
  I18nKey
> = {
  send: "onchainSendHistoryTitle",
  receive: "onchainReceiveHistoryTitle",
};

/**
 * The sats the payment history shows for a transfer: the agreed debit or
 * credit unless it ended otherwise, then what came back or arrived; null when
 * that is not known, as for an ending before any money moved or a receive of
 * any amount before its deposit.
 */
export const onchainTransferHistoryAmount = (
  transfer: Pick<
    OnchainTransferView,
    "amount" | "anyAmount" | "direction" | "phase" | "sendAmount" | "update"
  >,
): number | null => {
  switch (transfer.phase) {
    case "denied":
    case "cancelled":
    case "refunded":
      return (
        transfer.update?.refundAmount ?? transfer.update?.receivedAmount ?? null
      );
    default:
      if (transfer.direction === "send") return transfer.sendAmount;
      return transfer.anyAmount && transfer.update?.receivedAmount === undefined
        ? null
        : transfer.amount;
  }
};

export const ONCHAIN_TRANSFER_DIRECTION_ICONS: Record<
  OnchainTransferDirection,
  IconName
> = {
  send: "ArrowUpRight",
  receive: "ArrowDownRight",
};

export const ONCHAIN_TRANSFER_PHASE_LABEL_KEYS: Record<
  OnchainTransferPhase,
  I18nKey
> = {
  waitingForDetails: "onchainTransferPhaseWaitingForDetails",
  readyToSend: "onchainTransferPhaseReadyToSend",
  sent: "onchainTransferPhaseSent",
  awaitingDeposit: "onchainTransferPhaseAwaitingDeposit",
  depositSeen: "onchainTransferPhaseDepositSeen",
  depositConfirming: "onchainTransferPhaseDepositConfirming",
  shortDeposit: "onchainTransferPhaseShortDeposit",
  waitingForEcash: "onchainTransferPhaseWaitingForEcash",
  completed: "onchainTransferPhaseCompleted",
  denied: "onchainTransferPhaseDenied",
  cancelled: "onchainTransferPhaseCancelled",
  refunded: "onchainTransferPhaseRefunded",
};

/** Warning marks the phases that wait for the user. */
export const ONCHAIN_TRANSFER_PHASE_TONES: Record<OnchainTransferPhase, Tone> =
  {
    waitingForDetails: "info",
    readyToSend: "warning",
    sent: "info",
    awaitingDeposit: "warning",
    depositSeen: "info",
    depositConfirming: "info",
    shortDeposit: "danger",
    waitingForEcash: "info",
    completed: "accent",
    denied: "danger",
    cancelled: "neutral",
    refunded: "neutral",
  };

/** A fee in basis points as a percentage, 100 being 1 %. */
export const formatServiceFeePercent = (
  feeBasisPoints: number,
  lang: string,
): string =>
  new Intl.NumberFormat(normalizeLocale(lang), {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(feeBasisPoints / 10_000);
