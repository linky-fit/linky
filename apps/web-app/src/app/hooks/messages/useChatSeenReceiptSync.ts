import { decodeNpub, SeenReceiptDraft, UnixSeconds } from "@linky/linkstr";
import { sendSeenReceiptAtom, useAtomSet } from "@linky/linkstr-react";
import { Exit } from "effect";
import React from "react";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import type {
  LocalNostrMessage,
  RouteWithOptionalId,
} from "../../types/appTypes";
import { resolveSeenReceiptAdvance } from "../../lib/chatSeenReceipt";
import { summarizeConversationReadTimes } from "../../lib/chatUnread";

interface SeenReceiptContact {
  id?: string | null;
  npub?: string | null | undefined;
}

interface UseChatSeenReceiptSyncParams {
  chatMessages: readonly LocalNostrMessage[];
  documentVisible: boolean;
  /** Receipts-enabled baseline; null or 0 means the toggle is off. */
  seenReceiptsEnabledAtSec: number | null;
  route: RouteWithOptionalId;
  selectedContact: SeenReceiptContact | null;
  /** "Already reported up to" per peer pubkey, echo-seeded by the inbox. */
  sentUpToSecByPubkeyRef: React.MutableRefObject<Map<string, number>>;
}

/**
 * Reports the read cursor to the peer while their chat is open in a visible
 * tab. A failed send rolls the sent-cursor back so any later trigger (new
 * message, refocus, route re-entry) retries with a superseding receipt.
 */
export const useChatSeenReceiptSync = ({
  chatMessages,
  documentVisible,
  seenReceiptsEnabledAtSec,
  route,
  selectedContact,
  sentUpToSecByPubkeyRef,
}: UseChatSeenReceiptSyncParams): void => {
  const sendSeenReceipt = useAtomSet(sendSeenReceiptAtom, {
    mode: "promiseExit",
  });
  const inFlightRef = React.useRef(false);

  React.useEffect(() => {
    if (!documentVisible || route.kind !== "chat" || !selectedContact) return;
    const contactId = (selectedContact.id ?? "").trim();
    if (!contactId || contactId !== (route.id ?? "").trim()) return;

    const enabledAtSec = Math.floor(seenReceiptsEnabledAtSec ?? 0);
    if (enabledAtSec <= 0) return;

    const npub = normalizeNpubIdentifier(selectedContact.npub ?? "");
    const peerPubkey = npub ? decodeNpub(npub) : null;
    if (!peerPubkey) return;

    const sentByPubkey = sentUpToSecByPubkeyRef.current;
    const lastSentUpToSec = sentByPubkey.get(peerPubkey) ?? 0;
    const target = resolveSeenReceiptAdvance(
      summarizeConversationReadTimes(chatMessages),
      lastSentUpToSec,
      enabledAtSec,
    );
    if (target === null || inFlightRef.current) return;

    inFlightRef.current = true;
    sentByPubkey.set(peerPubkey, target);
    void sendSeenReceipt(
      new SeenReceiptDraft({
        to: peerPubkey,
        sinceSec: UnixSeconds.make(enabledAtSec),
        seenUpToSec: UnixSeconds.make(target),
      }),
    ).then((exit) => {
      inFlightRef.current = false;
      if (Exit.isSuccess(exit)) return;
      // Roll back only our own optimistic bump; an echo may have raced past it.
      if (sentByPubkey.get(peerPubkey) !== target) return;
      if (lastSentUpToSec > 0) sentByPubkey.set(peerPubkey, lastSentUpToSec);
      else sentByPubkey.delete(peerPubkey);
    });
  }, [
    chatMessages,
    documentVisible,
    route,
    seenReceiptsEnabledAtSec,
    selectedContact,
    sendSeenReceipt,
    sentUpToSecByPubkeyRef,
  ]);
};
