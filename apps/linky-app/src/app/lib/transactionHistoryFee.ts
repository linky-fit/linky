import { parseTokenText } from "@linky-fit/linkshu";

const readNonNegativeFiniteInt = (value: number | null): number | null => {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  return Math.trunc(value);
};

const sumTokenAmounts = (tokens: readonly string[]): number | null => {
  if (tokens.length === 0) return null;

  let sum = 0;
  for (const token of tokens) {
    const parsed = parseTokenText(token);
    if (!parsed) return null;
    sum += parsed.amount;
  }
  return sum;
};

export const calculateTransactionHistoryFee = (args: {
  amount: number | null;
  fallbackFee: number | null;
  gainedTokens: readonly string[];
  usedTokens: readonly string[];
}): number | null => {
  const amount = readNonNegativeFiniteInt(args.amount);
  const usedAmount = sumTokenAmounts(args.usedTokens);
  if (amount === null || usedAmount === null) return args.fallbackFee;

  const gainedAmount =
    args.gainedTokens.length > 0 ? sumTokenAmounts(args.gainedTokens) : 0;
  if (gainedAmount === null) return args.fallbackFee;

  const fee = usedAmount - amount - gainedAmount;
  return fee >= 0 ? fee : args.fallbackFee;
};
