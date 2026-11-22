import { NonNegativeAmount, WalletBalances } from "@linky-fit/linkshu";
import {
  isHiddenTestMint,
  isTestMintUrl,
  MAIN_MINT_URL,
} from "../../utils/mint";
import { isDevBuild } from "../../platform/buildEnv";

/** A build whose own main mint is a test mint would otherwise hide it and fall back to a production mint. */
export const allowTestMintsByDefault = (
  isDev: boolean,
  mainMintUrl: string,
): boolean => isDev || isTestMintUrl(mainMintUrl);

export const resolveAllowTestMints = (
  stored: boolean | null,
  buildDefault: boolean = allowTestMintsByDefault(isDevBuild, MAIN_MINT_URL),
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
