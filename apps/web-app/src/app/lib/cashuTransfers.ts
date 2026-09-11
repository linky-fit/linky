import type { TokenTransfer } from "@linky/linkshu";

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
