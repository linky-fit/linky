import { Pubkey } from "@linky-fit/linkstr";
import type { ListingRecord } from "@linky-fit/linksync";
import { createId, OwnerId, PositiveInt } from "@linky-fit/linksync";
import { describe, expect, it } from "vitest";
import {
  beaconTradeOfCashIntent,
  buildListingsDocument,
  formatListingPrice,
  listingCurrencyLabel,
  listingCurrencyOfDisplay,
  listingsPublishFingerprint,
  normalizeListingAmount,
} from "./listings";

const record = (overrides: Partial<ListingRecord> = {}): ListingRecord => ({
  id: createId<"Listing">(),
  createdAtSec: PositiveInt.orThrow(100),
  side: "offer",
  title: "Domácí vajíčka",
  amount: "90",
  currency: "CZK",
  unit: "za 10 ks",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  isDeleted: 0,
  ownerId: OwnerId.orThrow(createId()),
  ...overrides,
});

const alice = Pubkey.make(
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
);
const bob = Pubkey.make(
  "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245",
);

describe("buildListingsDocument", () => {
  it("orders listings by creation and drops a row the wire does not accept", () => {
    const later = record({
      createdAtSec: PositiveInt.orThrow(200),
      title: "Med",
    });
    const broken = record({ amount: "1.234" });
    const document = buildListingsDocument([later, record(), broken], "want");
    expect(document.cash).toBe("want");
    expect(document.listings.map(({ title }) => title)).toEqual([
      "Domácí vajíčka",
      "Med",
    ]);
  });

  it("fingerprints the document and the recipient set, order-insensitively", () => {
    const document = buildListingsDocument([record()], null);
    expect(listingsPublishFingerprint(document, [alice, bob])).toBe(
      listingsPublishFingerprint(document, [bob, alice]),
    );
    expect(listingsPublishFingerprint(document, [alice])).not.toBe(
      listingsPublishFingerprint(document, [alice, bob]),
    );
    expect(
      listingsPublishFingerprint(buildListingsDocument([], "offer"), [alice]),
    ).not.toBe(listingsPublishFingerprint(document, [alice]));
  });
});

describe("cash intent", () => {
  it("maps to the beacon trade", () => {
    expect(beaconTradeOfCashIntent("offer")).toBe("buy");
    expect(beaconTradeOfCashIntent("want")).toBe("sell");
    expect(beaconTradeOfCashIntent(null)).toBe("none");
  });
});

describe("listing amounts", () => {
  it("normalizes typed amounts and rejects what is not a price", () => {
    expect(normalizeListingAmount(" 1 800 ", "CZK")).toBe("1800");
    expect(normalizeListingAmount("12,5", "EUR")).toBe("12.5");
    expect(normalizeListingAmount("0", "CZK")).toBeNull();
    expect(normalizeListingAmount("1.234", "CZK")).toBeNull();
    expect(normalizeListingAmount("abc", "CZK")).toBeNull();
    expect(normalizeListingAmount("21000", "SAT")).toBe("21000");
    expect(normalizeListingAmount("21.5", "SAT")).toBeNull();
  });

  it("prices a listing in the display currency, sats for a bitcoin display", () => {
    expect(listingCurrencyOfDisplay("czk")).toBe("CZK");
    expect(listingCurrencyOfDisplay("sat")).toBe("SAT");
    expect(listingCurrencyOfDisplay("btc")).toBe("SAT");
    expect(listingCurrencyOfDisplay("hidden")).toBe("SAT");
    expect(listingCurrencyLabel("CZK", "cs")).toBe("Kč");
    expect(listingCurrencyLabel("SAT", "cs")).toBe("sat");
    expect(listingCurrencyLabel("XXX", "cs")).toBe("XXX");
  });

  it("shows a price in the viewer's unit, converted and marked when it differs", () => {
    const rates = {
      czkPerBtc: 2_000_000,
      eurPerBtc: 80_000,
      chfPerBtc: 80_000,
      usdPerBtc: 80_000,
      brlPerBtc: 400_000,
      fetchedAtMs: 1_754_000_000_000,
    };
    const czk = {
      displayCurrency: "czk" as const,
      fiatRates: rates,
      lang: "cs",
    };
    const sat = {
      displayCurrency: "sat" as const,
      fiatRates: rates,
      lang: "cs",
    };
    const squash = (text: string) => text.replace(/\s/g, " ");
    expect(squash(formatListingPrice("90", "CZK", czk))).toBe("90 Kč");
    expect(squash(formatListingPrice("1800", "CZK", czk))).toBe("1 800 Kč");
    expect(
      formatListingPrice("12.50", "EUR", { ...czk, lang: "en" as const }),
    ).toBe("~313 CZK");
    expect(squash(formatListingPrice("2000", "CZK", sat))).toBe("~100 000 sat");
    expect(squash(formatListingPrice("21000", "SAT", sat))).toBe("21 000 sat");
    expect(squash(formatListingPrice("200000", "SAT", czk))).toBe("~4 000 Kč");
    expect(formatListingPrice("5", "XXX", sat)).toContain("5");
    // Without rates the author's price stands.
    expect(
      squash(formatListingPrice("12.50", "EUR", { ...sat, fiatRates: null })),
    ).toBe("12,50 €");
  });
});
