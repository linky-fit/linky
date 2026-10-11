import { normalizeMintUrl } from "../../utils/mint";

export interface SendMintBalance {
  amount: number;
  mint: string;
}

/**
 * Picks the mint a linkshu send or melt should spend from: foreign mints
 * first (largest balance wins), the preferred/default mint last, so payments
 * drain foreign balances before touching the default mint.
 */
export const selectSendMintForAmount = (
  balances: readonly SendMintBalance[],
  preferredMint: string | null,
  amountSat: number,
): string | null => {
  if (!Number.isFinite(amountSat) || amountSat <= 0) return null;
  const preferred = normalizeMintUrl(preferredMint);
  const isPreferred = (mint: string): boolean =>
    Boolean(preferred) && normalizeMintUrl(mint) === preferred;

  return (
    [...balances]
      .sort((a, b) => {
        if (isPreferred(a.mint) !== isPreferred(b.mint)) {
          return isPreferred(a.mint) ? 1 : -1;
        }
        return b.amount - a.amount;
      })
      .find((entry) => entry.amount >= amountSat)?.mint ?? null
  );
};

/**
 * The spelling linkshu holds `mint`'s funds under. linkshu keys proofs by the
 * exact url it stored, while the app names a mint by `normalizeMintUrl`; of
 * several stored spellings the largest balance wins, an unfunded mint stays
 * `mint`.
 */
export const storedMintSpelling = (
  balances: readonly SendMintBalance[],
  mint: string,
): string => {
  const key = normalizeMintUrl(mint);
  const [largest] = balances
    .filter((entry) => entry.amount > 0 && normalizeMintUrl(entry.mint) === key)
    .sort((a, b) => b.amount - a.amount);
  return largest?.mint ?? mint;
};
