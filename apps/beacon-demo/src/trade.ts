import type { Person } from "./people";

/** Whether the user buys or sells bitcoin; the beacon carries it without an amount. */
export type Trade = "buy" | "sell";

export interface NearbyContact {
  person: Person;
  trade?: Trade;
}

export const tradeLabel = (trade: Trade) =>
  trade === "buy" ? "Buys BTC" : "Sells BTC";
