import {
  AutoswapEstimate,
  AutoswapReceipt,
  MintUrl,
  NonNegativeAmount,
  WalletBalances,
} from "@linky-fit/linkshu";
import { Schema } from "effect";

/** linkshu balances holding `amount` sat at each stored mint spelling. */
export const walletBalancesOf = (
  perMint: Record<string, number>,
): WalletBalances => {
  const entries = Object.entries(perMint).map(([mint, amount]) => ({
    mint: MintUrl.make(mint),
    amount: NonNegativeAmount.make(amount),
  }));
  const amounts = entries.map((entry) => entry.amount);
  return new WalletBalances({
    total: NonNegativeAmount.make(amounts.reduce((sum, a) => sum + a, 0)),
    spendable: NonNegativeAmount.make(Math.max(0, ...amounts)),
    perMint: entries,
  });
};

export const autoswapEstimateOf = (move: {
  readonly sourceMint: string;
  readonly targetMint: string;
}) =>
  Schema.decodeUnknownSync(AutoswapEstimate)({
    ...move,
    amount: 50,
    lightningFeeReserve: 2,
    inputFee: 1,
    totalFromSource: 53,
  });

export const autoswapReceiptOf = (move: {
  readonly sourceMint: string;
  readonly targetMint: string;
}) =>
  Schema.decodeUnknownSync(AutoswapReceipt)({
    ...move,
    movedAmount: 50,
    feePaid: 3,
    operationId: "AAAAAAAAAAAAAAAAAAAAAA",
  });
