import {
  decodePaymentRequestPayload,
  PaymentRequestId,
} from "@linky-fit/linkshu/payment-request";
import type { LocalNostrMessage } from "../types/appTypes";
import { boundedMemo } from "../../utils/boundedMemo";
import { trimString } from "../../utils/validation";
import {
  parseCashuPaymentRequestMessage,
  parseLinkyPaymentRequestDeclineMessage,
} from "./paymentRequestMessage";
import { extractCashuTokenFromText } from "./tokenText";
import {
  isPaymentRequestTransaction,
  parseJsonValue,
  readRequestIdFromDetails,
  type TransactionItem,
} from "./transactionHistory";

type PaymentRequestAnswer = "declined" | "paid";
export type PaymentRequestStatus = PaymentRequestAnswer | "requested";

type ConversationMessage = Pick<
  LocalNostrMessage,
  "content" | "createdAtSec" | "direction" | "replyToId" | "rumorId"
>;

/** The sats that reached the wallet from payloads naming each request id. */
export type ReceivedSatByRequestId = ReadonlyMap<PaymentRequestId, number>;

/** The columns of a payment history row that tell what a receive brought in. */
interface ReceiveRecord {
  readonly amount: number | null;
  readonly detailsJson: string | null;
  readonly direction: string;
  readonly method: string | null;
  readonly status: string;
  readonly unit: string | null;
}

/** Sums the successful sat receives of the payment history by the request id their payload named. */
export const receivedSatByRequestId = (
  records: readonly ReceiveRecord[],
): ReceivedSatByRequestId => {
  const received = new Map<PaymentRequestId, number>();
  for (const record of records) {
    if (
      record.direction !== "in" ||
      record.status !== "ok" ||
      record.method !== "cashu_receive" ||
      record.unit !== "sat" ||
      record.amount === null
    ) {
      continue;
    }
    const requestId = readRequestIdFromDetails(
      parseJsonValue(record.detailsJson),
    );
    if (requestId === null) continue;
    const id = PaymentRequestId.make(requestId);
    received.set(id, (received.get(id) ?? 0) + record.amount);
  }
  return received;
};

/** When the user paid each request id: the payment history's first successful payment naming it. */
export type PaidAtSecByRequestId = ReadonlyMap<PaymentRequestId, number>;

/** The columns of a payment history row that tell which request a payment paid. */
interface PaymentRecord {
  readonly createdAtSec: number;
  readonly detailsJson: string | null;
  readonly direction: string;
  readonly status: string;
}

/** Reads each request id's first successful outgoing payment from the payment history. */
export const paidAtSecByRequestId = (
  records: readonly PaymentRecord[],
): PaidAtSecByRequestId => {
  const paid = new Map<PaymentRequestId, number>();
  for (const record of records) {
    if (record.direction !== "out" || record.status !== "ok") continue;
    const requestId = readRequestIdFromDetails(
      parseJsonValue(record.detailsJson),
    );
    if (requestId === null) continue;
    const id = PaymentRequestId.make(requestId);
    const earlier = paid.get(id);
    if (earlier === undefined || record.createdAtSec < earlier) {
      paid.set(id, record.createdAtSec);
    }
  }
  return paid;
};

/** Whether the wallet received at least the requested amount for a request, or anything for an amountless one. */
export const isRequestPaidInFull = (
  received: ReceivedSatByRequestId,
  requestId: PaymentRequestId,
  amount: number | null,
): boolean => {
  const sat = received.get(requestId) ?? 0;
  return sat > 0 && sat >= (amount ?? 0);
};

/** What History shows for a request the user made; null for every other row. */
export type TransactionRequestStatus = "declined" | "paid" | "pending" | null;

/** A request the user made is paid once `received` holds its amount, whatever single payments named it. */
export const transactionRequestStatus = (
  item: TransactionItem,
  received: ReceivedSatByRequestId,
  declinedRequestIds: ReadonlySet<string>,
): TransactionRequestStatus => {
  if (!isPaymentRequestTransaction(item)) return null;
  const requestId = readRequestIdFromDetails(item.details);
  if (requestId === null) return null;
  const id = PaymentRequestId.make(requestId);
  if (isRequestPaidInFull(received, id, item.amount)) return "paid";
  if (declinedRequestIds.has(requestId)) return "declined";
  return "pending";
};

interface RequestParts {
  /** The id and amount of a payment request message; `requestId` is null for one without `i`. */
  request: { amount: number | null; requestId: PaymentRequestId | null } | null;
  /** A token or payload; `requestId` is what a NUT-18 payload names, null for a bare token. */
  payment: { requestId: PaymentRequestId | null } | null;
  isDecline: boolean;
}

const requestPartsOf = boundedMemo((content: string): RequestParts => {
  const request = parseCashuPaymentRequestMessage(content);
  const payment = decodePaymentRequestPayload(content);
  return {
    request: request && {
      amount: request.amount,
      requestId: request.requestId,
    },
    payment: payment
      ? { requestId: payment.requestId }
      : extractCashuTokenFromText(content) === null
        ? null
        : { requestId: null },
    isDecline: parseLinkyPaymentRequestDeclineMessage(content) !== null,
  };
}, 5_000);

interface Request {
  amount: number | null;
  direction: ConversationMessage["direction"];
  requestId: PaymentRequestId | null;
  rumorId: string;
}

/** Whether the user's own payment answers a request they received. */
const pays = (
  payment: ConversationMessage,
  paymentRequestId: PaymentRequestId | null,
  request: Request,
): boolean => {
  if (payment.direction !== "out" || request.direction !== "in") return false;
  if (request.requestId !== null && paymentRequestId === request.requestId) {
    return true;
  }
  // Only the payer can tell which request its reply paid, a bare token from an older Linky included.
  return trimString(payment.replyToId) === request.rumorId;
};

/**
 * The answered payment requests of one conversation by their rumor id; the
 * latest answer wins. The user's own payment answers a request they received
 * when its payload names the request id or it replies to the request. A
 * request the user sent is paid once `received` holds at least its amount
 * for its id, whoever paid it and in whichever conversation.
 */
export const paymentRequestAnswersByRumorId = (
  messages: readonly ConversationMessage[],
  received: ReceivedSatByRequestId,
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

  const answers = new Map(
    [...latest].map(([rumorId, { status }]) => [rumorId, status] as const),
  );
  for (const { amount, direction, requestId, rumorId } of requests) {
    if (
      direction === "out" &&
      requestId !== null &&
      isRequestPaidInFull(received, requestId, amount)
    ) {
      answers.set(rumorId, "paid");
    }
  }
  return answers;
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
