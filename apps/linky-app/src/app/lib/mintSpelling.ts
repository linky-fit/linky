import { normalizeMintUrl } from "../../utils/mint";

interface MintBalance {
  readonly mint: string;
  readonly amount: number;
}

/**
 * The spelling linkshu holds `mint`'s funds under. linkshu keys proofs by the
 * exact url it stored, while the app names a mint by `normalizeMintUrl`; of
 * several stored spellings the largest balance wins, an unfunded mint stays
 * `mint`.
 */
export const storedMintSpelling = (
  balances: ReadonlyArray<MintBalance>,
  mint: string,
): string => {
  const key = normalizeMintUrl(mint);
  const [largest] = balances
    .filter((entry) => entry.amount > 0 && normalizeMintUrl(entry.mint) === key)
    .sort((a, b) => b.amount - a.amount);
  return largest?.mint ?? mint;
};

/** Matches every spelling linkshu may store `mint`'s funds under, for `planSendMint`'s `isPreferredMint`. */
export const isSpellingOf = (
  mint: string | null,
): ((stored: string) => boolean) => {
  const key = normalizeMintUrl(mint);
  return (stored) => key !== "" && normalizeMintUrl(stored) === key;
};
