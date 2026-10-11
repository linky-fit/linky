import type { TokenTransfer } from "@linky-fit/linkshu";
import { decodeNpub } from "@linky-fit/linkstr";
import React from "react";
import { isOpenTransfer } from "../../lib/cashuTransfers";
import type { CashuTransferLifecycle } from "../../state/linkshu/commands";
import type { ContactRowLike, LocalNostrMessage } from "../../types/appTypes";
import { normalizePubkeyHex } from "../messages/contactIdentity";

interface UseTransferCleanupParams {
  chatMessages: readonly LocalNostrMessage[];
  contacts: readonly ContactRowLike[];
  currentNpub: string | null;
  lifecycle: CashuTransferLifecycle | null;
  nostrMessagesLocal: readonly LocalNostrMessage[];
  nostrMessagesRecent: readonly LocalNostrMessage[];
  walletTransfers: readonly TokenTransfer[];
}

/** Closes sends whose message reached the recipient and takes back tokens paid to ourselves. */
export const useTransferCleanup = ({
  chatMessages,
  contacts,
  currentNpub,
  lifecycle,
  nostrMessagesLocal,
  nostrMessagesRecent,
  walletTransfers,
}: UseTransferCleanupParams) => {
  // A messenger send whose token message is confirmed sent has reached its
  // recipient; the pending transfer has nothing left to guard.
  React.useEffect(() => {
    if (lifecycle === null) return;
    for (const transfer of walletTransfers) {
      if (transfer.kind !== "send" || transfer.status !== "pending") continue;
      const hasMessage = nostrMessagesLocal.some(
        (message) =>
          message.direction === "out" &&
          message.content.trim() === transfer.tokenText &&
          (message.status ?? "sent") !== "pending",
      );
      if (hasMessage) void lifecycle.forget(transfer.id);
    }
  }, [lifecycle, nostrMessagesLocal, walletTransfers]);

  // A cashu token paid to our own key lands back in our own inbox as an
  // incoming message the auto-claim skips (its proofs are already ours). A
  // token sent to anyone else never returns to us, so an incoming message
  // carrying one of our own still-open sends is unambiguously a self-payment;
  // reclaim that transfer back into the balance instead of leaving it stuck.
  const reclaimAttemptedRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    if (lifecycle === null) return;
    const ownPubkeyHex = normalizePubkeyHex(decodeNpub(currentNpub ?? ""));
    if (!ownPubkeyHex) return;
    // A self-payment resolves the request to a contact whose key is our own;
    // that contact's display name may be wrong, but its npub is ours.
    const selfContactIds = new Set(
      contacts
        .filter(
          (contact) =>
            normalizePubkeyHex(decodeNpub(contact.npub ?? "")) === ownPubkeyHex,
        )
        .map((contact) => String(contact.id).trim())
        .filter((id) => id.length > 0),
    );
    // A token that reached our own inbox (direction "in") or that we sent into
    // a self-chat is a self-payment; a token sent to anyone else never matches
    // one of our own open transfers here, so this cannot reclaim a real send.
    const selfDirectedTokenTexts = new Set(
      [...chatMessages, ...nostrMessagesRecent, ...nostrMessagesLocal]
        .filter((message) => {
          if (message.direction === "in") return true;
          const contactId = (message.contactId ?? "").toString().trim();
          return contactId.length > 0 && selfContactIds.has(contactId);
        })
        .map((message) => message.content.trim()),
    );
    for (const transfer of walletTransfers) {
      if (transfer.kind !== "send" || !isOpenTransfer(transfer)) continue;
      const id = String(transfer.id);
      if (reclaimAttemptedRef.current.has(id)) continue;
      if (!selfDirectedTokenTexts.has(transfer.tokenText.trim())) continue;
      reclaimAttemptedRef.current.add(id);
      void lifecycle.returnToWallet(transfer.id);
    }
  }, [
    chatMessages,
    contacts,
    currentNpub,
    lifecycle,
    nostrMessagesLocal,
    nostrMessagesRecent,
    walletTransfers,
  ]);
};
