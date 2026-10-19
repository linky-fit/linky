// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { updateSpdRecords } from "./bankPaymentOfferSpdStore.native";

const KEY = "linky.bank_payment_offer_spd";

const storedValues = (): unknown => JSON.parse(localStorage.getItem(KEY) ?? "");

describe("native updateSpdRecords", () => {
  beforeEach(() => localStorage.clear());

  it("starts empty and stores what the change puts", async () => {
    const seen = await updateSpdRecords((stored) => ({
      put: [{ offerId: "a", n: 1 }],
      remove: [],
      result: stored,
    }));
    expect(seen).toEqual([]);
    expect(storedValues()).toEqual([{ offerId: "a", n: 1 }]);
  });

  it("replaces records by offer id and removes the listed ones", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { offerId: "a", n: 1 },
        { offerId: "b", n: 1 },
        { offerId: "c", n: 1 },
      ]),
    );
    await updateSpdRecords(() => ({
      put: [{ offerId: "a", n: 2 }],
      remove: ["b"],
      result: null,
    }));
    expect(storedValues()).toEqual([
      { offerId: "c", n: 1 },
      { offerId: "a", n: 2 },
    ]);
  });

  it("hands the change each record under its offer id and drops unreadable ones", async () => {
    localStorage.setItem(KEY, JSON.stringify([{ offerId: "a" }, 7, {}]));
    const seen = await updateSpdRecords((stored) => ({
      put: [],
      remove: [],
      result: stored,
    }));
    expect(seen).toEqual([{ offerId: "a", value: { offerId: "a" } }]);
  });

  it("treats a corrupt store as empty", async () => {
    localStorage.setItem(KEY, "{not json");
    const seen = await updateSpdRecords((stored) => ({
      put: [],
      remove: [],
      result: stored.length,
    }));
    expect(seen).toBe(0);
  });
});
