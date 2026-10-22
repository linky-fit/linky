import { Schema } from "effect";

export const OperatorTransferStatus = Schema.Literals([
  "accepted",
  "denied",
  "fundsSeen",
  "fundsReceived",
  "completed",
  "cancelled",
  "refunded",
]);
export type OperatorTransferStatus = typeof OperatorTransferStatus.Type;

/** `fundsSeen` may repeat: each repeat reports new confirmations. */
const NEXT_STATUSES: Record<
  OperatorTransferStatus | "none",
  ReadonlyArray<OperatorTransferStatus>
> = {
  none: ["accepted", "denied", "cancelled"],
  accepted: ["fundsSeen", "fundsReceived", "cancelled"],
  fundsSeen: ["fundsSeen", "fundsReceived", "cancelled", "refunded"],
  fundsReceived: ["completed", "refunded"],
  denied: [],
  completed: [],
  cancelled: [],
  refunded: [],
};

/** Whether the operator may move a transfer from `from` (null: no update yet) to `to`. */
export const canOperatorMove = (
  from: OperatorTransferStatus | null,
  to: OperatorTransferStatus,
): boolean => NEXT_STATUSES[from ?? "none"].includes(to);

/** A status no later update may leave. */
export const isTerminalStatus = (status: OperatorTransferStatus): boolean =>
  NEXT_STATUSES[status].length === 0;
