import {
  buildBip321PaymentUri,
  encodeNostrPaymentRequest,
  PaymentRequestId,
} from "@linky-fit/linkshu";
import { decode, nprofileEncode } from "nostr-tools/nip19";
import { siteConfig } from "../config";
import type { BitcoinLeg } from "./store";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The support account with the relays it reads, as the Cashu request's Nostr transport names it. */
const supportNprofile = (): string => {
  const decoded = decode(siteConfig.supportNpub);
  if (decoded.type !== "npub") throw new Error("The support npub is invalid.");
  return nprofileEncode({
    pubkey: decoded.data,
    relays: [...siteConfig.supportRelays],
  });
};

/** A NUT-18 request for `sats` at any mint, paid as a NIP-17 message to the support account; the payment id names it. */
export const buildCashuRequest = (sats: number, paymentId: string): string =>
  encodeNostrPaymentRequest({
    amount: sats,
    mintUrls: [],
    recipientNprofile: supportNprofile(),
    requestId: PaymentRequestId.make(paymentId),
  });

const lnurlpUrl = () =>
  `https://${siteConfig.lightningAddressHost}/.well-known/lnurlp/${siteConfig.supportNpub}`;

const getJson = async (
  url: string,
  signal: AbortSignal,
): Promise<Record<string, unknown>> => {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error(`${url} answered no object`);
  return body;
};

/** A Lightning invoice for `sats` from the support account's Lightning address, the two LNURL-pay hops. */
export const fetchInvoice = async (
  sats: number,
  signal: AbortSignal,
): Promise<string> => {
  const pay = await getJson(lnurlpUrl(), signal);
  if (typeof pay.callback !== "string") {
    throw new Error("No LNURL-pay callback.");
  }
  const millisats = sats * 1000;
  if (
    (typeof pay.minSendable === "number" && millisats < pay.minSendable) ||
    (typeof pay.maxSendable === "number" && millisats > pay.maxSendable)
  ) {
    throw new Error("The amount is outside what the address accepts.");
  }
  const callback = new URL(pay.callback);
  callback.searchParams.set("amount", String(millisats));
  const invoice = await getJson(callback.toString(), signal);
  if (typeof invoice.pr !== "string") {
    throw new Error("No invoice.");
  }
  return invoice.pr;
};

/** Both legs of a Bitcoin payment for `sats`: the invoice from the network, the Cashu request built here. */
export const prepareBitcoinLeg = async (
  sats: number,
  paymentId: string,
  signal: AbortSignal,
): Promise<BitcoinLeg> => ({
  invoice: await fetchInvoice(sats, signal),
  request: buildCashuRequest(sats, paymentId),
  sats,
});

/** `bitcoin:?lightning=…&creq=…`, the universal QR code the app shows. */
export const bitcoinQrValue = (leg: BitcoinLeg): string =>
  buildBip321PaymentUri({ lightning: leg.invoice, creq: leg.request }) ??
  leg.invoice;
