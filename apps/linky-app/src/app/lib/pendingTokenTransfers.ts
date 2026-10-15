import type { StoredProof, TokenTransfer } from "@linky-fit/linkshu";
import type { LocalNostrMessage } from "../types/appTypes";
import { isOpenTransfer } from "./cashuTransfers";
import { extractCashuTokenFromText, tokenProofsKey } from "./tokenText";

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

/** Looks up the chat messages carrying a token, in whichever encoding they carry it. */
export const tokenChatMessages = (messages: readonly LocalNostrMessage[]) => {
  const byToken = new Map<string, LocalNostrMessage[]>();
  for (const message of messages) {
    const tokenText =
      extractCashuTokenFromText(message.content) ??
      extractCashuTokenFromText(message.originalContent ?? "");
    const key = tokenText === null ? null : tokenProofsKey(tokenText);
    if (key === null) continue;
    const matches = byToken.get(key) ?? [];
    if (
      !matches.some(
        (match) =>
          match.contactId === message.contactId &&
          match.direction === message.direction,
      )
    ) {
      matches.push(message);
    }
    byToken.set(key, matches);
  }
  return (tokenText: string): readonly LocalNostrMessage[] =>
    byToken.get(tokenProofsKey(tokenText) ?? "") ?? [];
};
