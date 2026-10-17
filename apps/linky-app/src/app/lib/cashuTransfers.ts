import type {
  StoredOperation,
  StoredProof,
  TokenTransfer,
} from "@linky-fit/linkshu";
import { isStoredCashuErrorTransient } from "./cashuStoredError";
import { tokenProofsKey } from "./tokenText";

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
 * Tokens, by `tokenProofsKey`, a chat message shows as taken, which
 * auto-accept skips: those of transfers and of deferred receives, pending or
 * closed, unless a receive of the token is still to be resumed.
 */
export const takenTokenProofs = (
  transfers: ReadonlyArray<TokenTransfer>,
  operations: ReadonlyArray<StoredOperation>,
): ReadonlySet<string> => {
  const resumable = new Set(
    transfers
      .filter(isInterruptedReceive)
      .map((transfer) => tokenProofsKey(transfer.tokenText)),
  );
  return new Set(
    [
      ...transfers.map((transfer) => transfer.tokenText),
      ...operations
        .filter((operation) => operation.kind === "deferredReceive")
        .flatMap((operation) =>
          operation.tokenText === null ? [] : [operation.tokenText],
        ),
    ].flatMap((text) => {
      const key = tokenProofsKey(text);
      return key === null || resumable.has(key) ? [] : [key];
    }),
  );
};

/** Tokens, by `tokenProofsKey`, whose funds the wallet received. */
export const receivedTokenProofs = (
  transfers: ReadonlyArray<TokenTransfer>,
): ReadonlySet<string> =>
  new Set(
    transfers
      .filter(
        (transfer) => transfer.kind === "receive" && transfer.status === "done",
      )
      .flatMap((transfer) => tokenProofsKey(transfer.tokenText) ?? []),
  );

/**
 * The wallet's own sends by `tokenProofsKey`: true once the recipient claimed it,
 * i.e. the mint reported spent proofs covering the whole amount, so a send
 * whose proofs have not all synced yet stays unclaimed. A returned send's
 * proofs were spent by the wallet itself.
 */
export const sentTokenClaims = (
  transfers: ReadonlyArray<TokenTransfer>,
  proofs: ReadonlyArray<StoredProof>,
): ReadonlyMap<string, boolean> => {
  const spentByOperation = new Map<string, { amount: number; all: boolean }>();
  for (const proof of proofs) {
    if (proof.operationId === null) continue;
    const spent = spentByOperation.get(proof.operationId);
    spentByOperation.set(proof.operationId, {
      amount: (spent?.amount ?? 0) + proof.amount,
      all: (spent?.all ?? true) && proof.state === "spent",
    });
  }
  const claims = new Map<string, boolean>();
  for (const transfer of transfers) {
    if (transfer.kind !== "send") continue;
    const key = tokenProofsKey(transfer.tokenText);
    if (key === null) continue;
    const spent = spentByOperation.get(transfer.id);
    claims.set(
      key,
      transfer.status !== "returned" &&
        spent !== undefined &&
        spent.all &&
        spent.amount === transfer.amount,
    );
  }
  return claims;
};
