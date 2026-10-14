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
