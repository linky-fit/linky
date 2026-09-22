import {
  decodeBankPaymentOffer,
  type BankPaymentOffer,
} from "@linky/proxy-payment";
import type { LocalNostrMessage } from "../types/appTypes";

/** The chat row of an offer thread; `pubkey` is the offerer, not the author. */
export const bankPaymentOfferMessageRow = (
  offer: BankPaymentOffer,
  contactId: string,
  myPubkey: string,
): LocalNostrMessage => ({
  ...(offer.clientId === null ? {} : { clientId: offer.clientId }),
  contactId,
  content: offer.content,
  createdAtSec: offer.createdAtSec,
  direction: offer.offererPublicKey === myPubkey ? "out" : "in",
  id: `bank-payment-offer:${contactId}:${offer.offerId}`,
  localOnly: true,
  pubkey: offer.offererPublicKey,
  rumorId: offer.snapshotId,
  status: "sent",
  wrapId: offer.snapshotId,
});

export const compareBankPaymentOfferRows = (
  a: LocalNostrMessage,
  b: LocalNostrMessage,
): number => a.createdAtSec - b.createdAtSec || a.id.localeCompare(b.id);

// Persisted chat rows from older builds can carry the same offer snapshot;
// every identity the two rows may share counts as a duplicate.
export const getBankPaymentOfferMessageKeys = (
  message: LocalNostrMessage,
): string[] => {
  const contactId = message.contactId.trim();
  const offerId = decodeBankPaymentOffer(message.content)?.offerId;
  const wrapId = message.wrapId.trim();
  const clientId = (message.clientId ?? "").trim();
  const id = message.id.trim();
  return [
    ...(offerId && contactId ? [`offer:${contactId}:${offerId}`] : []),
    ...(wrapId ? [`wrap:${wrapId}`] : []),
    ...(clientId ? [`client:${clientId}`] : []),
    ...(id ? [`id:${id}`] : []),
  ];
};

export const mergeBankPaymentOffersIntoChatMessages = (
  chatMessages: readonly LocalNostrMessage[],
  offerMessages: readonly LocalNostrMessage[],
): LocalNostrMessage[] => {
  if (offerMessages.length === 0) return [...chatMessages];

  const seenKeys = new Set(
    chatMessages.flatMap(getBankPaymentOfferMessageKeys),
  );
  const merged = [...chatMessages];
  for (const message of offerMessages) {
    const keys = getBankPaymentOfferMessageKeys(message);
    if (keys.some((key) => seenKeys.has(key))) continue;
    merged.push(message);
    for (const key of keys) seenKeys.add(key);
  }
  return merged.sort(compareBankPaymentOfferRows);
};

export const mergeBankPaymentOffersIntoLastMessageByContactId = (
  lastMessageByContactId: ReadonlyMap<string, LocalNostrMessage>,
  offerMessages: readonly LocalNostrMessage[],
): Map<string, LocalNostrMessage> => {
  const merged = new Map(lastMessageByContactId);
  for (const message of offerMessages) {
    const current = merged.get(message.contactId);
    if (!current || message.createdAtSec >= (current.createdAtSec || 0)) {
      merged.set(message.contactId, message);
    }
  }
  return merged;
};
