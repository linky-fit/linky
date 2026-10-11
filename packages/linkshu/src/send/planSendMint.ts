import type { MintUrl } from "../domain/primitives";

export interface PlanSendMintArgs {
  /** Per-mint balances, as `Tokens.balances.perMint` reports them. */
  readonly balances: ReadonlyArray<{
    readonly mint: MintUrl;
    readonly amount: number;
  }>;
  readonly amount: number;
  /**
   * Whether `mint` is the wallet's default mint, spent from last. It should
   * match every spelling the default mint's funds are stored under.
   */
  readonly isPreferredMint?: (mint: MintUrl) => boolean;
}

/**
 * The one mint a send or melt of `amount` should spend from: the largest
 * balance at any other mint that covers it, a preferred mint only when no
 * other one does. Null when no single mint covers it or `amount` is not
 * positive; a payment never splits across mints.
 */
export const planSendMint = ({
  balances,
  amount,
  isPreferredMint = () => false,
}: PlanSendMintArgs): MintUrl | null => {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return (
    [...balances]
      .sort((a, b) =>
        isPreferredMint(a.mint) !== isPreferredMint(b.mint)
          ? isPreferredMint(a.mint)
            ? 1
            : -1
          : b.amount - a.amount,
      )
      .find((balance) => balance.amount >= amount)?.mint ?? null
  );
};
