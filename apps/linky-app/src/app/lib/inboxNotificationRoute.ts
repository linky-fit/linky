interface InboxNotificationRoute {
  id?: string | null | undefined;
  kind: string;
  offerId?: string | undefined;
}

export const isOpenChatForContact = (
  route: InboxNotificationRoute,
  contactId: string,
): boolean =>
  route.kind === "chat" && Boolean(contactId) && (route.id ?? "") === contactId;

export const isOpenBankPaymentOffer = (
  route: InboxNotificationRoute,
  offerId: string,
): boolean =>
  route.kind === "bankPaymentOffer" &&
  Boolean(offerId) &&
  (route.offerId ?? "") === offerId;
