import type { LocalNostrMessage } from "../types/appTypes";
import { getLinkyBankPaymentOfferInfo } from "./bankPaymentOffer";

export const getBankPaymentOfferMessageKeys = (
  message: LocalNostrMessage,
): string[] => {
  const contactId = message.contactId.trim();
  const offerId = getLinkyBankPaymentOfferInfo(message.content)?.offerId;
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
