/**
 * BIP 321 / BIP 21 — Bitcoin URI scheme parser.
 *
 * Format: `bitcoin:[<address>][?<param>=<value>(&<param>=<value>)*]`
 *
 * BIP 321 extends BIP 21 to formalize multi-rail payment instructions: a
 * single `bitcoin:` URI can advertise an onchain address alongside lightning
 * BOLT11 invoices, BOLT12 offers, LNURL targets, and arbitrary extension
 * params (Ark, silent payments, etc.). Wallets pick whichever rail they
 * understand and ignore the rest. See
 * https://github.com/bitcoin/bips/blob/master/bip-0321.mediawiki.
 *
 * This module only parses the URI; routing the extracted payment leg into
 * Linky's existing flows happens in the scanned-text handler.
 */

import { isLightningAddress } from "../lnurlPay";
import { safeDecodeURIComponent, stripLightningPrefix } from "./url";

interface Bip321Parsed {
  address: string | null;
  amountBtc: number | null;
  amountSat: number | null;
  creq: string | null;
  extensions: Record<string, string>;
  label: string | null;
  lightning: string | null;
  lnAddress: string | null;
  lno: string | null;
  lnurl: string | null;
  message: string | null;
}

const BIP321_RESERVED_PARAMS: ReadonlySet<string> = new Set([
  "amount",
  "label",
  "lightning",
  "lnurl",
  "lno",
  "message",
  "creq",
  // `pj` (PayJoin) and `pjos` are reserved by BIP 78 — we don't act on them
  // but they're not extensions in the BIP 321 sense.
  "pj",
  "pjos",
]);

const BIP321_SCHEME_RE = /^bitcoin:/i;

const parseAmountBtcToSat = (raw: string | null): number | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const btc = Number(trimmed);
  if (!Number.isFinite(btc) || btc < 0) return null;
  // Round to the nearest satoshi; BIP 321 amounts are in BTC with up to 8
  // decimal places, but we still get the occasional `0.000004999999`
  // floating-point straggler from sender wallets.
  const sat = Math.round(btc * 1e8);
  return sat >= 0 ? sat : null;
};

/**
 * Returns `null` if the input is not a `bitcoin:` URI. Otherwise returns
 * the parsed components. Unknown extension params land in `extensions` so
 * future BIP 321 add-ons can be inspected without re-parsing.
 */
export const parseBip321Uri = (input: string): Bip321Parsed | null => {
  const value = input.trim();
  if (!BIP321_SCHEME_RE.test(value)) return null;

  const body = value.slice("bitcoin:".length);
  const queryIdx = body.indexOf("?");
  const addressPart = (queryIdx >= 0 ? body.slice(0, queryIdx) : body).trim();
  const queryPart = queryIdx >= 0 ? body.slice(queryIdx + 1) : "";

  // BIP 321 makes the address optional; some wallets emit
  // `bitcoin:?lightning=...` for lightning-only payments.
  const address = addressPart || null;

  const params = new URLSearchParams(queryPart);

  const get = (key: string): string | null => {
    const raw = params.get(key);
    if (raw === null) return null;
    const decoded = safeDecodeURIComponent(raw).trim();
    return decoded || null;
  };

  const lightningRaw = get("lightning");
  const lightning = lightningRaw ? stripLightningPrefix(lightningRaw) : null;

  const amountBtcRaw = get("amount");
  const amountSat = parseAmountBtcToSat(amountBtcRaw);
  const amountBtc =
    amountBtcRaw && Number.isFinite(Number(amountBtcRaw))
      ? Number(amountBtcRaw)
      : null;

  // Some senders smuggle a lightning address into the address part of the
  // URI (`bitcoin:user@example.com?amount=…`). It's not strictly conformant
  // but real wallets do it; surface it so the caller can decide.
  const lnAddress = address && isLightningAddress(address) ? address : null;

  const extensions: Record<string, string> = {};
  for (const [key, raw] of params.entries()) {
    if (BIP321_RESERVED_PARAMS.has(key.toLowerCase())) continue;
    extensions[key] = safeDecodeURIComponent(raw);
  }

  return {
    address: lnAddress ? null : address,
    amountBtc: Number.isFinite(amountBtc) ? amountBtc : null,
    amountSat,
    creq: get("creq"),
    extensions,
    label: get("label"),
    lightning,
    lnAddress,
    lno: get("lno"),
    lnurl: get("lnurl"),
    message: get("message"),
  };
};

export const buildBip321PaymentUri = (args: {
  creq?: string | null;
  lightning?: string | null;
}): string | null => {
  const params = new URLSearchParams();
  const lightning = (args.lightning ?? "").trim();
  const creq = (args.creq ?? "").trim();

  if (lightning) params.set("lightning", stripLightningPrefix(lightning));
  if (creq) params.set("creq", creq);

  const query = params.toString();
  return query ? `bitcoin:?${query}` : null;
};

interface Bip321PayableLeg {
  kind: "cashu-request" | "lightning" | "lnurl" | "ln-address";
  value: string;
}

/**
 * Pick the best payment leg from a BIP 321 URI that Linky can actually
 * settle. Order matches what most senders intend when they include
 * multiple rails:
 *
 *   1. `creq=` (Cashu request) — native Cashu transfer over Nostr.
 *   2. `lightning=` (BOLT11) — exact invoice with locked amount.
 *   3. `lnurl=` — LNURL-pay; user picks amount within mint/max.
 *   4. Lightning address in the address part of the URI.
 *
 * Returns `null` when the URI has only onchain content (Linky doesn't
 * settle onchain) or an unsupported rail (BOLT12, Ark, silent payments).
 */
export const pickBip321PayableLeg = (
  parsed: Bip321Parsed,
): Bip321PayableLeg | null => {
  if (parsed.creq && /^creqA/i.test(parsed.creq)) {
    return { kind: "cashu-request", value: parsed.creq };
  }
  if (parsed.lightning && /^(lnbc|lntb|lnbcrt)/i.test(parsed.lightning)) {
    return { kind: "lightning", value: parsed.lightning };
  }
  if (parsed.lnurl) {
    return { kind: "lnurl", value: parsed.lnurl };
  }
  if (parsed.lnAddress) {
    return { kind: "ln-address", value: parsed.lnAddress };
  }
  return null;
};
