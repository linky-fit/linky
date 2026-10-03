export const SUPPORTER_TIERS = ["bronze", "silver", "gold", "diamond"] as const;

export type SupporterTier = (typeof SUPPORTER_TIERS)[number];

/** The smallest single payment, in sat, that reaches each tier. */
export const SUPPORTER_TIER_AMOUNTS: Readonly<Record<SupporterTier, number>> = {
  bronze: 5_000,
  silver: 15_000,
  gold: 50_000,
  diamond: 500_000,
};

/** The highest tier one payment of `amountSat` reaches, or null below Bronze. */
export const supporterTierForAmount = (
  amountSat: number,
): SupporterTier | null =>
  [...SUPPORTER_TIERS]
    .reverse()
    .find((tier) => amountSat >= SUPPORTER_TIER_AMOUNTS[tier]) ?? null;

export const compareSupporterTiers = (
  a: SupporterTier,
  b: SupporterTier,
): number => SUPPORTER_TIERS.indexOf(a) - SUPPORTER_TIERS.indexOf(b);

/** True when `owned` includes the perks of `required`. */
export const supporterTierIncludes = (
  owned: SupporterTier,
  required: SupporterTier,
): boolean => compareSupporterTiers(owned, required) >= 0;

export const PRODUCTION_MINTS: ReadonlyArray<string> = [
  "https://cashu.cz",
  "https://mint.minibits.cash/Bitcoin",
  "https://kashu.me",
  "https://cashu.21m.lol",
];

/** Mints a supporter payment may come from in production. */
export const SUPPORTER_ACCEPTED_MINTS: ReadonlyArray<string> = PRODUCTION_MINTS;

/** The production Linky Bot identity; null until it is launched. */
export const LINKY_BOT_NPUB: string | null = null;

/** The Linky contact, where feedback goes; Linky Bot points other messages here. */
export const LINKY_CONTACT_NPUB =
  "npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8";

const GRACE_SECONDS = 7 * 24 * 60 * 60;

/**
 * When an award given at `awardedAtSec` stops counting: one calendar month
 * plus seven days later, or `validitySeconds` later when given (dev override).
 */
export const supporterAwardExpiresAt = (
  awardedAtSec: number,
  validitySeconds?: number,
): number => {
  if (validitySeconds !== undefined) return awardedAtSec + validitySeconds;
  const date = new Date(awardedAtSec * 1000);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const lastDayOfMonth = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDayOfMonth));
  return Math.floor(date.getTime() / 1000) + GRACE_SECONDS;
};

export const isSupporterAwardValid = (
  awardedAtSec: number,
  nowSec: number,
  validitySeconds?: number,
): boolean =>
  awardedAtSec <= nowSec &&
  supporterAwardExpiresAt(awardedAtSec, validitySeconds) > nowSec;
