import {
  decodeBankPaymentOffer,
  isBankPaymentOfferExpired,
  isTerminalBankPaymentOfferStatus,
  type BankPaymentOffer,
  type BankPaymentOfferInfo,
} from "@linky-fit/proxy-payment";
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

interface ReceivedOffer {
  createdAtSec: number;
  info: BankPaymentOfferInfo;
}

// The payer never sees the bank QR, so the amount is how two offers show up
// as the same payment.
const isSamePayment = (a: BankPaymentOfferInfo, b: BankPaymentOfferInfo) =>
  a.amountText === b.amountText && a.amountSat === b.amountSat;

const isLive = ({ createdAtSec, info }: ReceivedOffer, nowSec: number) =>
  !isTerminalBankPaymentOfferStatus(info.status) &&
  !isBankPaymentOfferExpired(info, createdAtSec, nowSec);

/**
 * The offer a payer's chat opens by itself: the newest live one still waiting
 * for an answer, unless the payer already answered, or saw the end of, another
 * offer of the same payment that was running when this one arrived.
 */
export const bankPaymentOfferToOpen = (
  rows: readonly LocalNostrMessage[],
  chatId: string,
  nowSec: number,
  isMinimized: (offerId: string) => boolean,
): string | null => {
  const received = rows.flatMap((row): ReceivedOffer[] => {
    const info =
      row.contactId.trim() === chatId && row.direction === "in"
        ? decodeBankPaymentOffer(row.content)
        : null;
    return info ? [{ createdAtSec: row.createdAtSec, info }] : [];
  });
  const updatedAtSec = ({ createdAtSec, info }: ReceivedOffer) =>
    info.statusUpdatedAtSec ?? createdAtSec;

  let newest: ReceivedOffer | null = null;
  for (const offer of received) {
    const { info } = offer;
    if (info.status !== "offered" || !isLive(offer, nowSec)) continue;
    if (isMinimized(info.offerId)) continue;
    const arrivedAtSec = info.initiatedAtSec ?? offer.createdAtSec;
    const overlapsAnsweredPayment = received.some(
      (other) =>
        other.info.offerId !== info.offerId &&
        other.info.status !== "offered" &&
        isSamePayment(other.info, info) &&
        (isLive(other, nowSec) || updatedAtSec(other) >= arrivedAtSec),
    );
    if (overlapsAnsweredPayment) continue;
    if (!newest || updatedAtSec(offer) > updatedAtSec(newest)) newest = offer;
  }
  return newest?.info.offerId ?? null;
};
