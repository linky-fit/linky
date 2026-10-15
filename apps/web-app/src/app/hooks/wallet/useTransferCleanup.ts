import type { TokenTransfer } from "@linky-fit/linkshu";
import React from "react";
import { isOpenTransfer } from "../../lib/cashuTransfers";
import { tokenProofsKey } from "../../lib/tokenText";
import type { CashuTransferLifecycle } from "../../state/linkshu/commands";
import type { ContactRowLike, LocalNostrMessage } from "../../types/appTypes";
import { decodeNpubOnce } from "../messages/contactIdentity";

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
    const pendingSends = walletTransfers.filter(
      (transfer) => transfer.kind === "send" && transfer.status === "pending",
    );
    if (pendingSends.length === 0) return;
    const sentProofs = new Set(
      nostrMessagesLocal.flatMap((message) =>
        message.direction === "out" && (message.status ?? "sent") !== "pending"
          ? (tokenProofsKey(message.content) ?? [])
          : [],
      ),
    );
    for (const transfer of pendingSends) {
      const key = tokenProofsKey(transfer.tokenText);
      if (key !== null && sentProofs.has(key))
        void lifecycle.forget(transfer.id);
    }
  }, [lifecycle, nostrMessagesLocal, walletTransfers]);

  // A cashu token paid to our own key lands back in our own inbox as an
  // incoming message the auto-claim skips (its proofs are already ours). A
  // token sent to anyone else never returns to us, so an incoming message
  // carrying one of our own still-open sends is unambiguously a self-payment;
  // reclaim that transfer back into the balance instead of leaving it stuck.
  const reclaimAttemptedRef = React.useRef<Set<string>>(new Set());
  // A self-payment resolves the request to a contact whose key is our own;
  // that contact's display name may be wrong, but its npub is ours.
  const selfContactIds = React.useMemo(() => {
    const ownPubkeyHex = decodeNpubOnce(currentNpub ?? "");
    if (!ownPubkeyHex) return null;
    return new Set(
      contacts
        .filter(
          (contact) => decodeNpubOnce(contact.npub ?? "") === ownPubkeyHex,
        )
        .map((contact) => String(contact.id).trim())
        .filter((id) => id.length > 0),
    );
  }, [contacts, currentNpub]);
  React.useEffect(() => {
    if (lifecycle === null || selfContactIds === null) return;
    const openSends = walletTransfers.filter(
      (transfer) =>
        transfer.kind === "send" &&
        isOpenTransfer(transfer) &&
        !reclaimAttemptedRef.current.has(String(transfer.id)),
    );
    if (openSends.length === 0) return;
    // A token that reached our own inbox (direction "in") or that we sent into
    // a self-chat is a self-payment; a token sent to anyone else never matches
    // one of our own open transfers here, so this cannot reclaim a real send.
    const selfDirectedProofs = new Set(
      [...chatMessages, ...nostrMessagesRecent, ...nostrMessagesLocal]
        .filter((message) => {
          if (message.direction === "in") return true;
          const contactId = (message.contactId ?? "").toString().trim();
          return contactId.length > 0 && selfContactIds.has(contactId);
        })
        .flatMap((message) => tokenProofsKey(message.content) ?? []),
    );
    for (const transfer of openSends) {
      const key = tokenProofsKey(transfer.tokenText);
      if (key === null || !selfDirectedProofs.has(key)) continue;
      reclaimAttemptedRef.current.add(String(transfer.id));
      void lifecycle.returnToWallet(transfer.id);
    }
  }, [
    chatMessages,
    lifecycle,
    nostrMessagesLocal,
    nostrMessagesRecent,
    selfContactIds,
    walletTransfers,
  ]);
};
