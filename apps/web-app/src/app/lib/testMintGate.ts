import { NonNegativeAmount, WalletBalances } from "@linky/linkshu";
import { isHiddenTestMint } from "../../utils/mint";

/** Synced `setting` key; the value is "1" or "0", absent means the build default. */
export const ALLOW_TEST_MINTS_SETTING_KEY = "allowTestMints";

/** Dev and E2E builds run against a local FakeWallet mint, so they allow test mints. */
const allowTestMintsBuildDefault =
  import.meta.env.DEV || import.meta.env.VITE_E2E === "1";

export const encodeAllowTestMints = (allow: boolean): string =>
  allow ? "1" : "0";

export const resolveAllowTestMints = (
  stored: string | null,
  buildDefault: boolean = allowTestMintsBuildDefault,
): boolean => (stored === null ? buildDefault : stored === "1");

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
