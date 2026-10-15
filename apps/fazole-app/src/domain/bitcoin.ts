import {
  buildBip321PaymentUri,
  decodePaymentRequestPayload,
  encodeNostrPaymentRequest,
  extractTokenText,
  parseTokenText,
  PaymentRequestId,
} from "@linky-fit/linkshu";
import { Sats } from "./money";
import type { Payment } from "./records";

/**
 * The NUT-18 request a customer's Cashu wallet pays: `sats` at the shop mint,
 * single use, sent as a NIP-17 message to this device, the same format Linky
 * builds. The payment id is the request id.
 */
export const buildCashuRequest = (request: {
  readonly sats: Sats;
  readonly mintUrl: string;
  readonly deviceNprofile: string;
  readonly paymentId: string;
}): string =>
  encodeNostrPaymentRequest({
    amount: request.sats,
    mintUrls: [request.mintUrl],
    recipientNprofile: request.deviceNprofile,
    requestId: PaymentRequestId.make(request.paymentId),
  });

/** `bitcoin:?lightning=<bolt11>&creq=<creqA…>`: a wallet pays whichever leg it understands. */
export const buildBitcoinPaymentUri = (
  invoice: string,
  cashuRequest: string,
): string =>
  buildBip321PaymentUri({ lightning: invoice, creq: cashuRequest }) ??
  `bitcoin:?lightning=${invoice}`;

/** What an incoming Cashu token or NUT-18 payload offers, read before receiving it. */
export interface IncomingCashu {
  readonly mint: string;
  /** Face value in the token's unit, before the mint's input fee. */
  readonly amount: number;
  /** `null` when the token names none, which means sat. */
  readonly unit: string | null;
  /** The request id a NUT-18 payload echoes; a bare token carries none. */
  readonly requestId: string | null;
  /** The sender's note, as Linky sends it in the token memo; unsanitized. */
  readonly memo: string | null;
}

/**
 * Reads a chat message's text: a wallet paying a request sends the NUT-18
 * payload JSON, a Linky user paying from the chat a bare `cashuB…` token.
 * `null` when it carries no token.
 */
export const readIncomingCashu = (text: string): IncomingCashu | null => {
  const payload = decodePaymentRequestPayload(text);
  if (payload !== null) {
    const { mint, amount, unit, requestId, memo } = payload;
    return { mint, amount, unit, requestId, memo };
  }
  const token = extractTokenText(text);
  const parsed = token === null ? null : parseTokenText(token);
  return parsed?.mint
    ? {
        mint: parsed.mint,
        amount: parsed.amount,
        unit: parsed.unit,
        requestId: null,
        memo: parsed.memo,
      }
    : null;
};

const normalizeMint = (mint: string) =>
  mint.trim().replace(/\/+$/u, "").toLowerCase();

/**
 * The payment whose request a received NUT-18 payload names, when the payload
 * pays at that request's mint in sat. A bare token names no request.
 */
export const paymentNamedBy = (
  incoming: IncomingCashu,
  payments: readonly Payment[],
): Payment | null =>
  incoming.requestId === null ||
  (incoming.unit !== null && incoming.unit !== "sat")
    ? null
    : (payments.find(
        (payment) =>
          payment.id === incoming.requestId &&
          payment.bitcoin !== null &&
          normalizeMint(payment.bitcoin.mintUrl) ===
            normalizeMint(incoming.mint),
      ) ?? null);

/** Below it, the mint's input fee takes too large a share of a Cashu payment. */
const MIN_BITCOIN_SATS = 10;

/**
 * The smallest Bitcoin request to offer at a mint charging `inputFeePpk` per
 * proof (NUT-02): ten times the most one proof's fee can be, so the token
 * stays payable and the fees of receiving and forwarding it leave most of it.
 */
export const minimumBitcoinSats = (inputFeePpk: number | null): Sats =>
  Sats.make(
    MIN_BITCOIN_SATS * Math.max(1, Math.ceil((inputFeePpk ?? 0) / 1000)),
  );
