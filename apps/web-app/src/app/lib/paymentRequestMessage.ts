import { decodeNprofilePubkey } from "@linky-fit/linkstr";
import {
  decodePaymentRequest,
  encodeNostrPaymentRequest,
} from "@linky-fit/linkshu/payment-request";
import { trimString } from "../../utils/validation";

export interface CashuPaymentRequestMessageInfo {
  amount: number;
  description: string | null;
  encodedRequest: string;
  mintUrls: string[];
  requestId: string | null;
  transportNprofile: string | null;
  transportPostUrl: string | null;
  transportPubkeyHex: string | null;
  unit: string;
}

const LINKY_PAYMENT_REQUEST_DECLINE_PREFIX = "linky:req-decline:v1";

export const buildCashuPaymentRequestMessage = encodeNostrPaymentRequest;

export const parseCashuPaymentRequestMessage = (
  value: string,
): CashuPaymentRequestMessageInfo | null => {
  const decoded = decodePaymentRequest(value);
  if (decoded === null) return null;
  if (
    decoded.amount === null ||
    !Number.isFinite(decoded.amount) ||
    decoded.amount <= 0
  ) {
    return null;
  }
  if (decoded.unit !== "sat") return null;

  const transportTarget =
    decoded.transports.find((transport) => transport.type === "nostr")
      ?.target ?? "";
  const transportPubkeyHex = transportTarget
    ? decodeNprofilePubkey(transportTarget)
    : null;
  const postTransport =
    decoded.transports.find((transport) => transport.type === "post") ?? null;

  return {
    amount: Math.trunc(decoded.amount),
    description: decoded.description,
    encodedRequest: decoded.encoded,
    mintUrls: [...decoded.mints],
    requestId: decoded.id,
    transportNprofile: transportPubkeyHex ? transportTarget : null,
    transportPostUrl: postTransport ? postTransport.target : null,
    transportPubkeyHex,
    unit: decoded.unit,
  };
};

export const buildLinkyPaymentRequestDeclineMessage = (
  requestRumorId: string,
) => `${LINKY_PAYMENT_REQUEST_DECLINE_PREFIX}:${trimString(requestRumorId)}`;

export const parseLinkyPaymentRequestDeclineMessage = (
  value: string,
): { requestRumorId: string | null } | null => {
  const normalized = trimString(value);
  if (!normalized.startsWith(`${LINKY_PAYMENT_REQUEST_DECLINE_PREFIX}:`)) {
    return null;
  }

  const requestRumorId = trimString(
    normalized.slice(LINKY_PAYMENT_REQUEST_DECLINE_PREFIX.length + 1),
  );

  return {
    requestRumorId: requestRumorId || null,
  };
};

/**
 * A NUT-18 POST transport target must use https, otherwise the bearer cashu
 * proofs it receives travel in the clear and any network observer can redeem
 * them. `http:` is accepted only in development builds (localhost testing).
 */
export const paymentRequestPostUrlIsAllowed = (
  rawUrl: string,
  options: { allowHttp: boolean },
): boolean => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && options.allowHttp;
};
