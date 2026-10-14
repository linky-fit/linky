import {
  Bolt11Invoice,
  getPayableLightningInvoice,
  isLnurlPayTarget,
  parseBip321Uri,
  stripLightningPrefix,
} from "@linky-fit/linkshu";
import {
  decodeNprofilePubkey,
  encodeNpub,
  parsePubkey,
  type Pubkey,
} from "@linky-fit/linkstr";

/** Where a withdrawal goes, read from typed, pasted or scanned text. */
export type WithdrawTarget =
  | {
      /** A cashu token sent to a Linky user as a NIP-17 chat message. */
      readonly kind: "cashu_chat";
      readonly pubkey: Pubkey;
      readonly npub: string;
    }
  | {
      /** A Lightning invoice; its amount is fixed. */
      readonly kind: "lightning_invoice";
      readonly invoice: Bolt11Invoice;
      readonly amountSats: number;
    }
  | {
      /** A Lightning address or LNURL-pay, asked for an invoice of any amount. */
      readonly kind: "lightning_address";
      readonly target: string;
    };

const LINKY_PROFILE_LINK =
  /^(?:https?:\/\/)?(?:[\w-]+\.)*linky\.fit\/p\/([^/?#\s]+)/iu;

/** An npub, nprofile, hex key, `nostr:` URI or a Linky profile link naming an npub. */
export const parsePubkeyInput = (text: string): Pubkey | null => {
  const trimmed = text.trim();
  const linked = LINKY_PROFILE_LINK.exec(trimmed)?.[1];
  let decoded: string;
  try {
    decoded = linked === undefined ? trimmed : decodeURIComponent(linked);
  } catch {
    return null;
  }
  const value = decoded.replace(/^nostr:/iu, "");
  return parsePubkey(value) ?? decodeNprofilePubkey(value.toLowerCase());
};

const lightningTarget = (value: string): WithdrawTarget | null => {
  if (/^ln(bc|tb|bcrt)/iu.test(value)) {
    const invoice = getPayableLightningInvoice(value.toLowerCase());
    return invoice === null
      ? null
      : {
          kind: "lightning_invoice",
          invoice: Bolt11Invoice.make(invoice.invoice),
          amountSats: invoice.amountSat,
        };
  }
  return value !== "" && isLnurlPayTarget(value)
    ? { kind: "lightning_address", target: value }
    : null;
};

/**
 * Decides what kind of withdrawal a text asks for: a Linky user (npub,
 * nprofile, `nostr:` URI, Linky profile link), a Lightning invoice, a
 * Lightning address or LNURL, or a BIP-321 `bitcoin:` URI's Lightning leg.
 * `null` for anything else, such as an on-chain address.
 */
export const parseWithdrawTarget = (text: string): WithdrawTarget | null => {
  const trimmed = text.trim();
  const pubkey = parsePubkeyInput(trimmed);
  if (pubkey !== null) {
    return { kind: "cashu_chat", pubkey, npub: encodeNpub(pubkey) };
  }
  if (LINKY_PROFILE_LINK.test(trimmed)) return null;
  const bip321 = parseBip321Uri(trimmed);
  if (bip321 !== null) {
    const leg = bip321.lightning ?? bip321.lnurl ?? bip321.lnAddress;
    return leg === null ? null : lightningTarget(stripLightningPrefix(leg));
  }
  return lightningTarget(stripLightningPrefix(trimmed));
};
