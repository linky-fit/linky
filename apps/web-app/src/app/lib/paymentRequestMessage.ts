import { parseP2pkPubkey, type P2pkPubkey } from "@linky-fit/linkshu";
import { decodeNprofile, type Pubkey, type RelayUrl } from "@linky-fit/linkstr";
import {
  decodePaymentRequest,
  decodePaymentRequestPayload,
  encodeNostrPaymentRequest,
  type PaymentRequestId,
} from "@linky-fit/linkshu/payment-request";
import { trimString } from "../../utils/validation";

export interface CashuPaymentRequestMessageInfo {
  /** Sats asked for; null when the payer picks the amount. */
  amount: number | null;
  description: string | null;
  encodedRequest: string;
  /** Mints the payee accepts; empty means any mint. */
  mintUrls: string[];
  /** The payee also takes other mints, preferring `mintUrls` (`mp`). */
  mintsAdvisory: boolean;
  /** Sats the payer adds when paying from a mint outside `mintUrls` (`mf`). */
  outsideMintFee: number;
  /** The first transport Linky can use, in the request's order of preference. */
  preferredTransport: "nostr" | "post" | null;
  /** P2PK key the proofs must be locked to (NUT-10); null for bearer proofs. */
  lockTo: P2pkPubkey | null;
  /** NUT-18 `i`, echoed as the payment payload's `id`; not a Nostr event id. */
  requestId: PaymentRequestId | null;
  transportNprofile: string | null;
  transportPostUrl: string | null;
  transportPubkeyHex: Pubkey | null;
  /** Relay hints of the nostr transport's nprofile. */
  transportRelays: RelayUrl[];
  unit: "sat";
}

const LINKY_PAYMENT_REQUEST_DECLINE_PREFIX = "linky:req-decline:v1";

export const buildCashuPaymentRequestMessage = encodeNostrPaymentRequest;

/**
 * A NUT-18 request Linky can pay: sat, a positive amount or none, and at most
 * a plain P2PK lock (`lockTo` takes one key and no extra conditions).
 */
export const parseCashuPaymentRequestMessage = (
  value: string,
): CashuPaymentRequestMessageInfo | null => {
  const decoded = decodePaymentRequest(value);
  if (decoded === null) return null;
  if (
    decoded.amount !== null &&
    (!Number.isFinite(decoded.amount) || decoded.amount <= 0)
  ) {
    return null;
  }
  if ((decoded.unit ?? "sat") !== "sat") return null;
  const lockTo =
    decoded.lock === null
      ? null
      : decoded.lock.kind === "P2PK" && decoded.lock.tags.length === 0
        ? parseP2pkPubkey(decoded.lock.data)
        : undefined;
  if (lockTo === undefined || (decoded.lock !== null && lockTo === null)) {
    return null;
  }

  const nostrTransport =
    decoded.transports.find(
      (transport) =>
        transport.type === "nostr" && decodeNprofile(transport.target) !== null,
    ) ?? null;
  const nostrTarget = nostrTransport?.target ?? "";
  const nprofile = nostrTarget ? decodeNprofile(nostrTarget) : null;
  const postTransport =
    decoded.transports.find((transport) => transport.type === "post") ?? null;
  const preferredTransport =
    decoded.transports.flatMap((transport) =>
      transport === postTransport
        ? ["post" as const]
        : transport === nostrTransport
          ? ["nostr" as const]
          : [],
    )[0] ?? null;
  // Linky's mints all melt over bolt11; any other method's support is unknown, so the dearest one is owed.
  const outsideMintFee =
    decoded.methods.find((method) => method.method === "bolt11")?.fee ??
    Math.max(0, ...decoded.methods.map((method) => method.fee));

  return {
    amount: decoded.amount === null ? null : Math.trunc(decoded.amount),
    description: decoded.description,
    encodedRequest: decoded.encoded,
    lockTo,
    mintUrls: [...decoded.mints],
    mintsAdvisory: decoded.mintsAdvisory,
    outsideMintFee,
    preferredTransport,
    requestId: decoded.id,
    transportNprofile: nprofile ? nostrTarget : null,
    transportPostUrl: postTransport ? postTransport.target : null,
    transportPubkeyHex: nprofile?.pubkey ?? null,
    transportRelays: nprofile ? [...nprofile.relays] : [],
    unit: "sat",
  };
};

/** The request a NUT-18 payment payload names; null for a bare token or text. */
export const paymentRequestIdOfPayment = (
  content: string,
): PaymentRequestId | null =>
  decodePaymentRequestPayload(content)?.requestId ?? null;

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
