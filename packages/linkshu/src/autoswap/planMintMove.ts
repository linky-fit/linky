import type { MintUrl } from "../domain/primitives";

export interface MintMovePlan {
  /** The mint with the largest balance other than `toMint`. */
  readonly fromMint: MintUrl;
  readonly toMint: MintUrl;
  readonly sourceBalance: number;
  readonly targetBalance: number;
  /** `targetBalance + sourceBalance`: an upper bound, the move pays fees. */
  readonly maxBalanceAfterMove: number;
}

export interface PlanMintMoveArgs {
  /** Per-mint balances, as `Tokens.balances.perMint` reports them. */
  readonly balances: ReadonlyArray<{
    readonly mint: MintUrl;
    readonly amount: number;
  }>;
  /** Where the funds should end up, usually the default mint. */
  readonly toMint: MintUrl;
}

const positive = (amount: number): number =>
  Number.isFinite(amount) && amount > 0 ? amount : 0;

/**
 * Plans sweeping the largest other mint's balance into `toMint` (run it with
 * `Autoswap.claim`). Null when no other mint holds funds. Planning moves
 * nothing.
 */
export const planMintMove = ({
  balances,
  toMint,
}: PlanMintMoveArgs): MintMovePlan | null => {
  let targetBalance = 0;
  let source: { mint: MintUrl; amount: number } | null = null;
  for (const balance of balances) {
    const amount = positive(balance.amount);
    if (amount === 0) continue;
    if (balance.mint === toMint) targetBalance += amount;
    else if (source === null || amount > source.amount)
      source = { mint: balance.mint, amount };
  }
  if (source === null) return null;
  return {
    fromMint: source.mint,
    toMint,
    sourceBalance: source.amount,
    targetBalance,
    maxBalanceAfterMove: targetBalance + source.amount,
  };
};

/**
 * Whether `plan` makes `amount` payable when no single mint covers it now:
 * `amount` is above `spendable` (the largest single-mint balance,
 * `WalletBalances.spendable`) and within `plan.maxBalanceAfterMove`.
 */
export const mintMoveCovers = ({
  plan,
  amount,
  spendable,
}: {
  readonly plan: MintMovePlan | null;
  readonly amount: number;
  readonly spendable: number;
}): boolean =>
  plan !== null &&
  Number.isFinite(amount) &&
  amount > spendable &&
  amount <= plan.maxBalanceAfterMove;
