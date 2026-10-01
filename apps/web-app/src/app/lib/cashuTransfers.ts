import type { StoredOperation, TokenTransfer } from "@linky-fit/linkshu";
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

/** A token kept because its mint could not be used; linkshu retries it. */
export const isPendingDeferredReceive = (operation: StoredOperation): boolean =>
  operation.kind === "deferredReceive" && operation.status === "pending";

/** A pending deferral the wallet shows; its amount is summed and shown as sat. */
export const isShownDeferredReceive = (operation: StoredOperation): boolean =>
  isPendingDeferredReceive(operation) && operation.unit === "sat";

/**
 * A receive a reload or crash cut short, or whose swap response was lost
 * (`failed` with a transient error); receiving its text again resumes it.
 */
export const isInterruptedReceive = (transfer: TokenTransfer): boolean =>
  transfer.kind === "receive" &&
  (transfer.status === "pending" ||
    (transfer.status === "failed" &&
      isStoredCashuErrorTransient(transfer.error)));

/**
 * Token texts a chat message shows as taken: those of transfers, except a
 * receive still to be resumed, and of tokens linkshu keeps for a retry.
 */
export const takenTokenTexts = (
  transfers: ReadonlyArray<TokenTransfer>,
  operations: ReadonlyArray<StoredOperation>,
): ReadonlySet<string> =>
  new Set([
    ...transfers
      .filter((transfer) => !isInterruptedReceive(transfer))
      .map((transfer) => transfer.tokenText),
    ...operations
      .filter(isPendingDeferredReceive)
      .flatMap((operation) =>
        operation.tokenText === null ? [] : [operation.tokenText],
      ),
  ]);
