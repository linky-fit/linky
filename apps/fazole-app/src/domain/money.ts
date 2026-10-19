import { Schema } from "effect";

/** CZK amount in haléře (1 CZK = 100 haléřů). */
export const CzkAmount = Schema.Natural.pipe(Schema.brand("CzkAmount"));
export type CzkAmount = typeof CzkAmount.Type;

export const Sats = Schema.Natural.pipe(Schema.brand("Sats"));
export type Sats = typeof Sats.Type;

const SATS_PER_BTC = 100_000_000n;

/** Rounds up so the merchant never receives less than the CZK amount. */
export const czkToSats = (amount: CzkAmount, czkPerBtc: number): Sats => {
  const halerePerBtc = BigInt(Math.round(czkPerBtc * 100));
  const numerator = BigInt(amount) * SATS_PER_BTC;
  return Sats.make(Number((numerator + halerePerBtc - 1n) / halerePerBtc));
};

/** The CZK value of `sats`, rounded to haléře, e.g. for an "≈ CZK" hint. */
export const satsToCzk = (sats: number, czkPerBtc: number): CzkAmount =>
  CzkAmount.make(Math.round((sats * czkPerBtc * 100) / Number(SATS_PER_BTC)));

/** The smallest CZK amount that `czkToSats` prices at `sats` or more, e.g. for a "od 0,20 Kč" note. */
export const minimumCzkFor = (sats: number, czkPerBtc: number): CzkAmount =>
  CzkAmount.make(
    Math.floor(((sats - 1) * czkPerBtc * 100) / Number(SATS_PER_BTC)) + 1,
  );

/**
 * A typed CZK amount, e.g. `100`, `100,50`, `1 000.5`; `null` unless it is
 * a positive amount with at most two decimals.
 */
export const parseCzkInput = (text: string): CzkAmount | null => {
  const compact = text.replace(/\s/gu, "").replace(",", ".");
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/u.exec(compact);
  if (match === null) return null;
  const [, whole = "0", fraction = ""] = match;
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return amount > 0 ? CzkAmount.make(amount) : null;
};
