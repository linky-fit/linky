import { NonNegativeAmount, WalletBalances } from "@linky-fit/linkshu";
import { isHiddenTestMint } from "../../utils/mint";
import { isDevBuild, isE2eBuild } from "../../platform/buildEnv";

/** Dev and E2E builds run against a local FakeWallet mint, so they allow test mints. */
const allowTestMintsBuildDefault = isDevBuild || isE2eBuild;

export const resolveAllowTestMints = (
  stored: boolean | null,
  buildDefault: boolean = allowTestMintsBuildDefault,
): boolean => stored ?? buildDefault;

export const withoutHiddenTestMints = <T extends { readonly mint: string }>(
  items: ReadonlyArray<T>,
  allowTestMints: boolean,
): ReadonlyArray<T> =>
  allowTestMints
    ? items
    : items.filter((item) => !isHiddenTestMint(item.mint, allowTestMints));

/** Balances without hidden test mints; `spendable` stays the largest single-mint amount. */
export const visibleWalletBalances = (
  balances: WalletBalances,
  allowTestMints: boolean,
): WalletBalances => {
  const perMint = withoutHiddenTestMints(balances.perMint, allowTestMints);
  if (perMint === balances.perMint) return balances;
  const amounts = perMint.map((balance) => balance.amount);
  return new WalletBalances({
    total: NonNegativeAmount.make(amounts.reduce((sum, a) => sum + a, 0)),
    spendable: NonNegativeAmount.make(Math.max(0, ...amounts)),
    perMint,
  });
};
