import {
  Bolt11Invoice,
  getPayableLightningInvoice,
  isLnurlPayTarget,
  parseBip321Uri,
  parseMintUrl,
  stripLightningPrefix,
  type MintUrl,
  type WalletBalances,
} from "@linky-fit/linkshu";

/** Where a Lightning payment goes, read from pasted text. */
export type LightningTarget =
  | {
      /** A Lightning invoice; its amount is fixed. */
      readonly kind: "invoice";
      readonly invoice: Bolt11Invoice;
      readonly amountSats: number;
      readonly expiresAtSec: number;
    }
  | {
      /** A Lightning address or LNURL-pay, asked for an invoice of the typed amount. */
      readonly kind: "address";
      readonly target: string;
    };

const lightningTarget = (value: string): LightningTarget | null => {
  if (/^ln(bc|tb|bcrt)/iu.test(value)) {
    const invoice = getPayableLightningInvoice(value.toLowerCase());
    return invoice === null
      ? null
      : {
          kind: "invoice",
          invoice: Bolt11Invoice.make(invoice.invoice),
          amountSats: invoice.amountSat,
          expiresAtSec: invoice.expiresAtSec,
        };
  }
  return value !== "" && isLnurlPayTarget(value)
    ? { kind: "address", target: value }
    : null;
};

/**
 * A Lightning invoice, a Lightning address or LNURL, or the Lightning leg of
 * a BIP-321 `bitcoin:` URI; `null` for anything else, such as an on-chain address.
 */
export const parseLightningTarget = (text: string): LightningTarget | null => {
  const trimmed = text.trim();
  const bip321 = parseBip321Uri(trimmed);
  if (bip321 !== null) {
    const leg = bip321.lightning ?? bip321.lnurl ?? bip321.lnAddress;
    return leg === null ? null : lightningTarget(stripLightningPrefix(leg));
  }
  return lightningTarget(stripLightningPrefix(trimmed));
};

/** A positive whole number of sats; spaces and underscores inside it are ignored. */
export const parseSats = (text: string): number | null => {
  const digits = text.replace(/[\s_]/gu, "");
  if (!/^[1-9]\d*$/u.test(digits)) return null;
  const sats = Number(digits);
  return Number.isSafeInteger(sats) ? sats : null;
};

export interface MintFunds {
  readonly mint: MintUrl;
  readonly sats: number;
}

/** The picked mint while it still holds ecash, else the first one. */
export const sourceMint = (
  funds: readonly MintFunds[],
  picked: MintUrl | null,
): MintFunds | null =>
  funds.find(({ mint }) => mint === picked) ?? funds[0] ?? null;

/** Mints holding ecash, the transfer mint first and then the largest balance. */
export const fundedMints = (
  balances: WalletBalances | null,
  transferMint: string,
): readonly MintFunds[] => {
  const preferred = parseMintUrl(transferMint);
  return (balances?.perMint ?? [])
    .filter((entry) => entry.amount > 0)
    .map((entry) => ({ mint: entry.mint, sats: entry.amount }))
    .sort(
      (a, b) =>
        Number(parseMintUrl(b.mint) === preferred) -
          Number(parseMintUrl(a.mint) === preferred) || b.sats - a.sats,
    );
};
