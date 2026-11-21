import { createId } from "@linky-fit/domain";
import { describe, expect, it } from "vitest";
import { linkyStore, runNow } from "../testing/linky";
import { makeListingsRepository, normalizeListing } from "./listings";

const listing = () => ({
  id: createId<"Listing">(),
  createdAtSec: 100,
  side: "offer",
  title: "Domácí vajíčka",
  amount: "90",
  currency: "CZK",
  unit: "za 10 ks",
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
    runNow(listings.update(row.id, { amount: "95" }));
    expect(runNow(listings.all)).toMatchObject([{ amount: "95" }]);
    runNow(listings.remove(row.id));
    expect(runNow(listings.all)).toEqual([]);
  });

  it("keeps the optional image and clears it with null", () => {
    const { store } = linkyStore();
    const listings = makeListingsRepository(store);
    const row = listing();
    runNow(listings.insert(row));
    expect(runNow(listings.all)).toMatchObject([{ image: null }]);
    runNow(listings.update(row.id, { image: "{}" }));
    expect(runNow(listings.all)).toMatchObject([{ image: "{}" }]);
    runNow(listings.update(row.id, { image: null }));
    expect(runNow(listings.all)).toMatchObject([{ image: null }]);
  });

  it("keeps the optional description and clears it with null", () => {
    const { store } = linkyStore();
    const listings = makeListingsRepository(store);
    const row = listing();
    runNow(listings.insert(row));
    expect(runNow(listings.all)).toMatchObject([{ description: null }]);
    runNow(
      listings.update(row.id, {
        description: "Line one\nline two",
      }),
    );
    expect(runNow(listings.all)).toMatchObject([
      { description: "Line one\nline two" },
    ]);
    runNow(listings.update(row.id, { description: null }));
    expect(runNow(listings.all)).toMatchObject([{ description: null }]);
  });

  it("skips a row still arriving column by column", () => {
    const { store } = linkyStore();
    const listings = makeListingsRepository(store);
    const row = listing();
    runNow(listings.insert(row));
    const stored = runNow(listings.byId(row.id));
    expect(stored).not.toBeNull();
    if (stored === null) return;
    expect(normalizeListing(stored)).not.toBeNull();
    for (const column of ["side", "title", "amount", "unit"] as const) {
      expect(normalizeListing({ ...stored, [column]: null })).toBeNull();
    }
  });
});
