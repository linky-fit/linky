import type {
  StoredOperation,
  StoredProof,
  TokenTransfer,
} from "@linky-fit/linkshu";
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
 * Token texts a chat message shows as taken, which auto-accept skips: those
 * of transfers and of deferred receives, pending or closed, unless a receive
 * of the text is still to be resumed.
 */
export const takenTokenTexts = (
  transfers: ReadonlyArray<TokenTransfer>,
  operations: ReadonlyArray<StoredOperation>,
): ReadonlySet<string> => {
  const resumable = new Set(
    transfers
      .filter(isInterruptedReceive)
      .map((transfer) => transfer.tokenText),
  );
  return new Set(
    [
      ...transfers.map((transfer) => transfer.tokenText),
      ...operations
        .filter((operation) => operation.kind === "deferredReceive")
        .flatMap((operation) =>
          operation.tokenText === null ? [] : [operation.tokenText],
        ),
    ].filter((text) => !resumable.has(text)),
  );
};

/**
 * The wallet's own sends by token text: true once the recipient claimed it,
 * i.e. the mint reported every proof it handed out spent. A returned send's
 * proofs were spent by the wallet itself.
 */
export const sentTokenClaims = (
  transfers: ReadonlyArray<TokenTransfer>,
  proofs: ReadonlyArray<StoredProof>,
): ReadonlyMap<string, boolean> => {
  const allSpentByOperation = new Map<string, boolean>();
  for (const proof of proofs) {
    if (proof.operationId === null) continue;
    allSpentByOperation.set(
      proof.operationId,
      (allSpentByOperation.get(proof.operationId) ?? true) &&
        proof.state === "spent",
    );
  }
  return new Map(
    transfers
      .filter((transfer) => transfer.kind === "send")
      .map((transfer) => [
        transfer.tokenText,
        transfer.status !== "returned" &&
          (allSpentByOperation.get(transfer.id) ?? false),
      ]),
  );
};
