import {
  decodePaymentRequestPayload,
  type PaymentRequestId,
} from "@linky-fit/linkshu/payment-request";
import type { LocalNostrMessage } from "../types/appTypes";
import { boundedMemo } from "../../utils/boundedMemo";
import { trimString } from "../../utils/validation";
import {
  parseCashuPaymentRequestMessage,
  parseLinkyPaymentRequestDeclineMessage,
} from "./paymentRequestMessage";
import { extractCashuTokenFromText } from "./tokenText";

type PaymentRequestAnswer = "declined" | "paid";
export type PaymentRequestStatus = PaymentRequestAnswer | "requested";

type ConversationMessage = Pick<
  LocalNostrMessage,
  "content" | "createdAtSec" | "direction" | "replyToId" | "rumorId"
>;

interface RequestParts {
  /** The request id of a payment request message, null for one without `i`. */
  request: { requestId: PaymentRequestId | null } | null;
  /** A token or payload; `requestId` is what a NUT-18 payload names, null for a bare token. */
  payment: { requestId: PaymentRequestId | null } | null;
  isDecline: boolean;
}

const requestPartsOf = boundedMemo((content: string): RequestParts => {
  const request = parseCashuPaymentRequestMessage(content);
  const payment = decodePaymentRequestPayload(content);
  return {
    request: request && { requestId: request.requestId },
    payment: payment
      ? { requestId: payment.requestId }
      : extractCashuTokenFromText(content) === null
        ? null
        : { requestId: null },
    isDecline: parseLinkyPaymentRequestDeclineMessage(content) !== null,
  };
}, 5_000);

interface Request {
  direction: ConversationMessage["direction"];
  requestId: PaymentRequestId | null;
  rumorId: string;
}

const pays = (
  payment: ConversationMessage,
  paymentRequestId: PaymentRequestId | null,
  request: Request,
): boolean => {
  if (payment.direction === request.direction) return false;
  // Only the payer can tell which request its reply paid, a bare token from an older Linky included.
  if (
    payment.direction === "out" &&
    trimString(payment.replyToId) === request.rumorId
  ) {
    return true;
  }
  return request.requestId !== null && paymentRequestId === request.requestId;
};

/**
 * The answered payment requests of one conversation by their rumor id; the
 * latest answer wins. A payment answers a request when its payload names the
 * request id and travels the other way, or when it is the user's own payment
 * replying to a request they received.
 */
export const paymentRequestAnswersByRumorId = (
  messages: readonly ConversationMessage[],
): Map<string, PaymentRequestAnswer> => {
  const requests: Request[] = [];
  for (const message of messages) {
    const rumorId = trimString(message.rumorId);
    const { request } = requestPartsOf(message.content);
    if (rumorId && request) {
      requests.push({ ...request, direction: message.direction, rumorId });
    }
  }

  const latest = new Map<
    string,
    { atSec: number; status: PaymentRequestAnswer }
  >();
  const answer = (
    rumorId: string,
    atSec: number,
    status: PaymentRequestAnswer,
  ) => {
    const previous = latest.get(rumorId);
    if (previous && previous.atSec > atSec) return;
    latest.set(rumorId, { atSec, status });
  };

  for (const message of messages) {
    const { isDecline, payment } = requestPartsOf(message.content);
    const atSec = message.createdAtSec || 0;
    const replyToId = trimString(message.replyToId);
    if (isDecline && replyToId) answer(replyToId, atSec, "declined");
    if (!payment) continue;
    for (const request of requests) {
      if (pays(message, payment.requestId, request)) {
        answer(request.rumorId, atSec, "paid");
      }
    }
  }

  return new Map(
    [...latest].map(([rumorId, { status }]) => [rumorId, status] as const),
  );
};

/**
 * The request id an incoming payment fulfills: its payload's id, when the
 * user sent a request with that id in the payment's conversation.
 */
export const requestIdFulfilledBy = (
  payment: Pick<LocalNostrMessage, "content" | "direction">,
  conversation: readonly Pick<LocalNostrMessage, "content" | "direction">[],
): PaymentRequestId | null => {
  if (payment.direction !== "in") return null;
  const requestId = requestPartsOf(payment.content).payment?.requestId ?? null;
  if (requestId === null) return null;
  return conversation.some(
    (message) =>
      message.direction === "out" &&
      requestPartsOf(message.content).request?.requestId === requestId,
  )
    ? requestId
    : null;
};
