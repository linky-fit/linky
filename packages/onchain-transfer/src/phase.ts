import type { OnchainTransferDirection } from "./constants";
import type { OnchainTransferUpdate } from "./messages";
import type { OperatorTransferStatus } from "./status";

/** Where a transfer stands as Linky shows it to the user. */
export type OnchainTransferPhase =
  | "waitingForDetails"
  | "readyToSend"
  | "sent"
  | "awaitingDeposit"
  | "depositSeen"
  /** receive: less than the amount plus the fee arrived, so it cannot complete. */
  | "shortDeposit"
  | "waitingForEcash"
  | "completed"
  | "denied"
  | "cancelled"
  | "refunded";

export interface OnchainTransferPhaseInput {
  readonly direction: OnchainTransferDirection;
  /** The newest update from the operator, if any arrived. */
  readonly update: OnchainTransferUpdate | null;
  readonly userCancelledAtSec: number | null;
  /** send: when the user paid the operator's request. */
  readonly sentAtSec: number | null;
  /** receive: the user's request has received its amount. */
  readonly requestPaid: boolean;
}

/** The phases in which no funds have moved yet, so the user may still withdraw. */
export const canUserCancel = (phase: OnchainTransferPhase): boolean =>
  phase === "waitingForDetails" ||
  phase === "readyToSend" ||
  phase === "awaitingDeposit";

const sendPhase = (
  status: OperatorTransferStatus | null,
  sent: boolean,
): OnchainTransferPhase => {
  switch (status) {
    case null:
      return "waitingForDetails";
    case "accepted":
      return sent ? "sent" : "readyToSend";
    case "fundsSeen":
    case "fundsReceived":
      return "sent";
    default:
      return status;
  }
};

const isShortDeposit = (update: OnchainTransferUpdate | null): boolean =>
  update !== null &&
  (update.status === "fundsSeen" || update.status === "fundsReceived") &&
  update.receivedAmount !== undefined &&
  update.receivedAmount < update.sendAmount;

const receivePhase = (
  update: OnchainTransferUpdate | null,
  requestPaid: boolean,
): OnchainTransferPhase => {
  if (requestPaid) return "completed";
  if (isShortDeposit(update)) return "shortDeposit";
  const status = update?.status ?? null;
  switch (status) {
    case null:
      return "waitingForDetails";
    case "accepted":
      return "awaitingDeposit";
    case "fundsSeen":
      return "depositSeen";
    // The operator's `completed` alone credits nothing: only the receives naming the request complete it.
    case "fundsReceived":
    case "completed":
      return "waitingForEcash";
    default:
      return status;
  }
};

export const onchainTransferPhase = (
  input: OnchainTransferPhaseInput,
): OnchainTransferPhase => {
  const phase =
    input.direction === "send"
      ? sendPhase(input.update?.status ?? null, input.sentAtSec !== null)
      : receivePhase(input.update, input.requestPaid);
  return input.userCancelledAtSec !== null && canUserCancel(phase)
    ? "cancelled"
    : phase;
};
