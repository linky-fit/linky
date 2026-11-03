import {
  NonEmptyString100,
  NonEmptyString1000,
  PositiveInt,
} from "@evolu/common";
import { describe, expect, it } from "vitest";
import { createId } from "@linky-fit/domain";
import { linkyStore, runNow } from "../testing/linky";
import { makeListingsRepository, normalizeListing } from "./listings";

const text = (value: string) => NonEmptyString100.orThrow(value);

const listing = () => ({
  id: createId<"Listing">(),
  createdAtSec: PositiveInt.orThrow(100),
  side: text("offer"),
  title: NonEmptyString1000.orThrow("Domácí vajíčka"),
  amount: text("90"),
  currency: text("CZK"),
  unit: text("za 10 ks"),
});

describe("listings repository", () => {
  it("returns records whose columns are complete and drops removed ones", () => {
    const { store } = linkyStore();
    const listings = makeListingsRepository(store);
    const row = listing();
    runNow(listings.insert(row));
    expect(runNow(listings.all)).toMatchObject([
      { id: row.id, title: "Domácí vajíčka", amount: "90", unit: "za 10 ks" },
    ]);
    runNow(listings.update(row.id, { amount: text("95") }));
    expect(runNow(listings.all)).toMatchObject([{ amount: "95" }]);
    runNow(listings.remove(row.id));
    expect(runNow(listings.all)).toEqual([]);
  });

  it("skips a row still arriving column by column", () => {
    const { store } = linkyStore();
    const listings = makeListingsRepository(store);
    runNow(listings.insert(listing()));
    const [stored] = runNow(store.rows("contacts", "listing"));
    expect(stored).toBeDefined();
    if (!stored) return;
    expect(normalizeListing(stored)).not.toBeNull();
    for (const column of ["side", "title", "amount", "unit"] as const) {
      expect(normalizeListing({ ...stored, [column]: null })).toBeNull();
    }
  });
});
