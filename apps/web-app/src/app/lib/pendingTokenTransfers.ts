import type { StoredProof, TokenTransfer } from "@linky/linkshu";
import type { LocalNostrMessage } from "../types/appTypes";
import { isOpenTransfer } from "./cashuTransfers";
import { extractCashuTokenFromText } from "./tokenText";

export const pendingTokenTransfers = (
  transfers: readonly TokenTransfer[],
  proofs: readonly StoredProof[],
) => {
  const outstanding = new Set(
    proofs
      .filter(
        (proof) =>
          proof.state === "handedOut" || proof.state === "externalized",
      )
      .map((proof) => proof.operationId),
  );
  return transfers
    .filter(
      (transfer) =>
        transfer.kind === "send" &&
        (isOpenTransfer(transfer) ||
          (transfer.status === "done" && outstanding.has(transfer.id))),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
};

export const tokenChatMessages = (messages: readonly LocalNostrMessage[]) => {
  const byToken = new Map<string, LocalNostrMessage[]>();
  for (const message of messages) {
    const token =
      extractCashuTokenFromText(message.content) ??
      extractCashuTokenFromText(message.originalContent ?? "");
    if (token === null) continue;
    const matches = byToken.get(token) ?? [];
    if (
      !matches.some(
        (match) =>
          match.contactId === message.contactId &&
          match.direction === message.direction,
      )
    ) {
      matches.push(message);
    }
    byToken.set(token, matches);
  }
  return byToken;
};
