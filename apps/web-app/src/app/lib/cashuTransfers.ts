import type { TokenTransfer } from "@linky-fit/linkshu";
import { isStoredCashuErrorTransient } from "./cashuStoredError";

/** A transfer the user is still waiting on: something can still happen to it. */
export const isOpenTransfer = (transfer: TokenTransfer): boolean =>
  transfer.kind === "send"
    ? transfer.status === "issued" ||
      transfer.status === "pending" ||
      transfer.status === "externalized"
    : transfer.status === "pending" || transfer.status === "failed";

/** Transfers whose funds can still come back into the wallet. */
export const canReturnTransfer = isOpenTransfer;

/** A sent token shown as a QR or link, waiting for its recipient. */
export const isIssuedTransfer = (transfer: TokenTransfer): boolean =>
  transfer.kind === "send" && transfer.status === "issued";

/**
 * A receive a reload or crash cut short, or whose swap response was lost
 * (`failed` with a transient error); receiving its text again resumes it.
 */
export const isInterruptedReceive = (transfer: TokenTransfer): boolean =>
  transfer.kind === "receive" &&
  (transfer.status === "pending" ||
    (transfer.status === "failed" &&
      isStoredCashuErrorTransient(transfer.error)));
