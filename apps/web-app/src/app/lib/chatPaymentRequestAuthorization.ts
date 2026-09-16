import { decodeNpub } from "@linky/linkstr";
import type { ContactRowLike, LocalNostrMessage } from "../types/appTypes";
import {
  parseCashuPaymentRequestMessage,
  type CashuPaymentRequestMessageInfo,
} from "./paymentRequestMessage";

export const isCurrentChatPaymentRequest = (
  reviewed: LocalNostrMessage,
  request: CashuPaymentRequestMessageInfo,
  recipient: ContactRowLike,
  messages: readonly LocalNostrMessage[],
  currentRecipient: ContactRowLike | null,
): boolean => {
  const current = messages.find((message) => message.id === reviewed.id);
  if (
    !current ||
    !currentRecipient ||
    reviewed.direction !== "in" ||
    current.direction !== "in" ||
    current.isEdited ||
    reviewed.isEdited ||
    !reviewed.rumorId ||
    current.rumorId !== reviewed.rumorId ||
    current.content !== reviewed.content ||
    current.pubkey !== reviewed.pubkey ||
    current.contactId !== reviewed.contactId ||
    current.editedAtSec !== reviewed.editedAtSec ||
    recipient.id !== reviewed.contactId ||
    currentRecipient.id !== recipient.id ||
    currentRecipient.npub !== recipient.npub ||
    decodeNpub(recipient.npub ?? "") !== reviewed.pubkey
  )
    return false;
  const parsed = parseCashuPaymentRequestMessage(reviewed.content);
  return (
    parsed !== null &&
    parsed.encodedRequest === request.encodedRequest &&
    parsed.amount === request.amount &&
    parsed.requestId === request.requestId
  );
};
