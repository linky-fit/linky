import type { LocalNostrMessage } from "../types/appTypes";
import { getLinkyBankPaymentOfferInfo } from "./bankPaymentOffer";

export const getAuthorizedBankOffer = (
  requested: LocalNostrMessage,
  authorizedMessages: readonly LocalNostrMessage[],
): LocalNostrMessage | null =>
  authorizedMessages.find(
    (message) =>
      message.id === requested.id &&
      message.contactId === requested.contactId &&
      message.content === requested.content &&
      message.rumorId === requested.rumorId,
  ) ?? null;

export const getBankOfferForSettlement = (
  requested: LocalNostrMessage,
  authorizedMessages: readonly LocalNostrMessage[],
  myPubkey: string | null,
): LocalNostrMessage | null => {
  if (!myPubkey) return null;
  const current = getAuthorizedBankOffer(requested, authorizedMessages);
  if (!current || current.direction !== "out") return null;
  const info = getLinkyBankPaymentOfferInfo(current.content);
  return info?.status === "bank_paid" && info.offererPublicKey === myPubkey
    ? current
    : null;
};
