const normalizeMint = (value: string): string =>
  value.trim().replace(/\/+$/, "");

export interface SendMintBalance {
  amount: number;
  mint: string;
}

/**
 * Picks the mint a linkshu send or melt should spend from: foreign mints
 * first (largest balance wins), the preferred/default mint last, so payments
 * drain foreign balances before touching the main mint.
 */
export const selectSendMintForAmount = (
  balances: readonly SendMintBalance[],
  preferredMint: string | null,
  amountSat: number,
): string | null => {
  if (!Number.isFinite(amountSat) || amountSat <= 0) return null;
  const preferred = normalizeMint(preferredMint ?? "");
  const isPreferred = (mint: string): boolean =>
    Boolean(preferred) && normalizeMint(mint) === preferred;

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
