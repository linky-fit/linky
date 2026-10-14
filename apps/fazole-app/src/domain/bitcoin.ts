import {
  buildBip321PaymentUri,
  decodePaymentRequest,
  decodePaymentRequestPayload,
  encodeNostrPaymentRequest,
  extractTokenText,
  parseTokenText,
} from "@linky-fit/linkshu";
import { Sats } from "./money";
import type { PaymentStatus } from "./payment";

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
    requestId: request.paymentId,
  });

/** `bitcoin:?lightning=<bolt11>&creq=<creqA…>`: a wallet pays whichever leg it understands. */
export const buildBitcoinPaymentUri = (
  invoice: string,
  cashuRequest: string,
): string =>
  buildBip321PaymentUri({ lightning: invoice, creq: cashuRequest }) ??
  `bitcoin:?lightning=${invoice}`;

/** The mint a stored Cashu request is payable at. */
export const cashuRequestMint = (cashuRequest: string): string | null =>
  decodePaymentRequest(cashuRequest)?.mints[0] ?? null;

/** What an incoming Cashu token or NUT-18 payload offers, read before receiving it. */
export interface IncomingCashu {
  readonly mint: string;
  /** Face value in the token's unit, before the mint's input fee. */
  readonly amount: number;
  /** `null` when the token names none, which means sat. */
  readonly unit: string | null;
  /** The request id a NUT-18 payload echoes; a bare token carries none. */
  readonly requestId: string | null;
}

/**
 * Reads a chat message's text: Linky sends a bare `cashuB…` token, other
 * wallets the NUT-18 payload JSON. `null` when it carries no token.
 */
export const readIncomingCashu = (text: string): IncomingCashu | null => {
  const payload = decodePaymentRequestPayload(text);
  if (payload !== null) {
    const { mint, amount, unit, requestId } = payload;
    return { mint, amount, unit, requestId };
  }
  const token = extractTokenText(text);
  const parsed = token === null ? null : parseTokenText(token);
  return parsed?.mint
    ? {
        mint: parsed.mint,
        amount: parsed.amount,
        unit: parsed.unit,
        requestId: null,
      }
    : null;
};

/** A payment whose Bitcoin request a token can still pay. */
export interface OpenBitcoinPayment {
  readonly id: string;
  readonly status: PaymentStatus;
  readonly sats: Sats;
  readonly mintUrl: string;
  readonly createdAtSec: number;
}

/** How long an unpaid request keeps its amount, so a token that pays it late still finds it. */
export const OPEN_REQUEST_SEC = 24 * 60 * 60;

/** An unpaid request, also a cancelled one, from the last `OPEN_REQUEST_SEC`. */
export const isOpenBitcoinRequest = (
  payment: { readonly status: PaymentStatus; readonly createdAtSec: number },
  nowSec: number,
): boolean =>
  payment.status !== "paid" && nowSec - payment.createdAtSec < OPEN_REQUEST_SEC;

/**
 * The sats a new request asks: `sats`, raised a sat at a time past every
 * amount an open request asks, because a bare token names no request and is
 * matched by its amount alone.
 */
export const uniqueRequestSats = (
  sats: Sats,
  open: ReadonlyArray<{ readonly sats: number }>,
): Sats => {
  const taken = new Set(open.map((payment) => payment.sats));
  let unique: number = sats;
  while (taken.has(unique)) unique += 1;
  return Sats.make(unique);
};

const normalizeMint = (mint: string) =>
  mint.trim().replace(/\/+$/u, "").toLowerCase();

export const sameMint = (a: string, b: string): boolean =>
  normalizeMint(a) === normalizeMint(b);

/**
 * The payment an incoming token pays, if any; a cancelled one still counts.
 * A payload naming its request pays that request. A bare token names none,
 * so it pays the one open request at its mint asking exactly its amount, and
 * nothing when no request or several do.
 */
export const matchIncomingCashu = <P extends OpenBitcoinPayment>(
  incoming: IncomingCashu,
  payments: readonly P[],
): P | null =>
  matchAmong(
    incoming,
    payments.filter((payment) => payment.status !== "paid"),
  );

/** The paid payment a further token pays again, matched the same way: the customer paid it twice. */
export const matchRepeatedCashu = <P extends OpenBitcoinPayment>(
  incoming: IncomingCashu,
  payments: readonly P[],
): P | null =>
  matchAmong(
    incoming,
    payments.filter((payment) => payment.status === "paid"),
  );

const matchAmong = <P extends OpenBitcoinPayment>(
  incoming: IncomingCashu,
  payments: readonly P[],
): P | null => {
  if (incoming.unit !== null && incoming.unit !== "sat") return null;
  const atMint = payments.filter((payment) =>
    sameMint(payment.mintUrl, incoming.mint),
  );
  if (incoming.requestId !== null) {
    return (
      atMint.find(
        (payment) =>
          payment.id === incoming.requestId && incoming.amount >= payment.sats,
      ) ?? null
    );
  }
  const asked = atMint.filter((payment) => payment.sats === incoming.amount);
  return asked.length === 1 ? (asked[0] ?? null) : null;
};

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
