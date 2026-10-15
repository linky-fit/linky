import { decodeBankPaymentOffer } from "@linky-fit/proxy-payment";
import {
  parseCashuPaymentRequestMessage,
  parseLinkyPaymentRequestDeclineMessage,
} from "./paymentRequestMessage";
import { getCashuTokenMessageInfo } from "./tokenMessageInfo";

/**
 * What a deleted message's `content` column holds: the column must not be
 * empty, and an app version without the placeholder shows this instead of
 * the text that is gone.
 */
export const DELETED_MESSAGE_CONTENT = "[deleted]";

export const isDeletedMessage = (message: {
  readonly deletedAtSec?: number | null | undefined;
}): boolean => (message.deletedAtSec ?? 0) > 0;

/**
 * A token, payment request, decline or bank offer stays: its text is what
 * claims the funds and what marks a request paid, so deleting it could lose
 * the funds or let the request be paid twice.
 */
export const carriesPayment = (content: string): boolean =>
  getCashuTokenMessageInfo(content) !== null ||
  parseCashuPaymentRequestMessage(content) !== null ||
  parseLinkyPaymentRequestDeclineMessage(content) !== null ||
  decodeBankPaymentOffer(content) !== null;
