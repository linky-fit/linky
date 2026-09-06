interface PaymentMintBalance {
  mint: string;
  sum: number;
}

interface PaymentMintMeltPlan {
  fromMint: string;
  maxBalanceAfterMelt: number;
  sourceBalance: number;
  targetBalance: number;
  toMint: string;
}

export const getPaymentMintMeltPlan = (args: {
  balances: readonly PaymentMintBalance[];
  mainMint: string | null;
}): PaymentMintMeltPlan | null => {
  const mainMint = (args.mainMint ?? "").trim();
  if (!mainMint) return null;

  let targetBalance = 0;
  let source: PaymentMintBalance | null = null;

  for (const balance of args.balances) {
    const mint = balance.mint.trim();
    const sum =
      Number.isFinite(balance.sum) && balance.sum > 0 ? balance.sum : 0;
    if (!mint || sum <= 0) continue;

    if (mint === mainMint) {
      targetBalance += sum;
      continue;
    }

    if (!source || sum > source.sum) source = { mint, sum };
  }

  if (!source) return null;

  return {
    fromMint: source.mint,
    maxBalanceAfterMelt: targetBalance + source.sum,
    sourceBalance: source.sum,
    targetBalance,
    toMint: mainMint,
  };
};

export const canOfferPaymentMintMelt = (args: {
  amountSat: number;
  currentBalance: number;
  plan: PaymentMintMeltPlan | null;
}): boolean => {
  if (!args.plan) return false;
  if (!Number.isFinite(args.amountSat) || args.amountSat <= 0) return false;
  return (
    args.amountSat > args.currentBalance &&
    args.amountSat <= args.plan.maxBalanceAfterMelt
  );
};
