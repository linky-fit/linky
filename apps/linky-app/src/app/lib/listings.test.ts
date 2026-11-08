import {
  ListingAmount,
  ListingCurrency,
  PrivateImage,
  Pubkey,
  RelayUrl,
} from "@linky-fit/linkstr";
import type { ListingRecord } from "@linky-fit/linksync";
import {
  createId,
  NonEmptyString,
  NonEmptyString1000,
  OwnerId,
  PositiveInt,
} from "@linky-fit/linksync";
import { describe, expect, it } from "vitest";
import type { DisplayAmountOptions } from "../../utils/displayAmounts";
import {
  beaconTradeOfCashIntent,
  buildListingsDocument,
  encodeListingImage,
  formatListingPrice,
  defaultListingUnit,
  filterListingAmountInput,
  listingCurrencyLabel,
  listingOfRecord,
  listingPriceInput,
  listingPriceUnits,
  listingUnitOfDisplay,
  listingWireCurrency,
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
  priceByAgreement: null,
  description: null,
  image: null,
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

describe("listingOfRecord", () => {
  it("passes the stored description through and leaves it out when there is none", () => {
    const description = NonEmptyString1000.orThrow(
      "Volný chov.\nVyzvednutí v Brně.",
    );
    expect(listingOfRecord(record({ description }))?.description).toBe(
      description,
    );
    expect(listingOfRecord(record())).not.toHaveProperty("description");
  });

  const image = new PrivateImage({
    url: "https://blossom.example/eggs",
    fileType: "image/jpeg",
    encryptionAlgorithm: "aes-gcm",
    key: "11".repeat(32),
    nonce: "22".repeat(12),
    encryptedSha256: "33".repeat(32),
    originalSha256: "44".repeat(32),
    encryptedSize: 2048,
    width: 640,
    height: 480,
    storageEncoding: "base64",
  });

  it("passes the stored image through and leaves out one that does not decode", () => {
    const listing = (value: string) =>
      listingOfRecord(record({ image: NonEmptyString.orThrow(value) }));
    expect(listing(encodeListingImage(image))?.image).toEqual(image);
    for (const broken of ["not json", '{"url":"x"}']) {
      expect(listing(broken)?.title).toBe("Domácí vajíčka");
      expect(listing(broken)).not.toHaveProperty("image");
    }
    expect(listingOfRecord(record())).not.toHaveProperty("image");
  });

  it("publishes the price-by-agreement flag only when the row sets it", () => {
    expect(
      listingOfRecord(record({ amount: "0", priceByAgreement: 1 }))
        ?.priceByAgreement,
    ).toBe(true);
    expect(listingOfRecord(record({ amount: "0" }))).not.toHaveProperty(
      "priceByAgreement",
    );
  });
});

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

  it("fingerprints a publication, ignoring recipient and relay order", () => {
    const publication = {
      document: buildListingsDocument([record()], null),
      recipients: [alice, bob],
      relays: [
        RelayUrl.make("wss://a.example"),
        RelayUrl.make("wss://b.example"),
      ],
      refreshPeriod: 1,
    };
    const fingerprint = listingsPublishFingerprint(publication);
    expect(
      listingsPublishFingerprint({
        ...publication,
        recipients: [bob, alice],
        relays: [...publication.relays].reverse(),
      }),
    ).toBe(fingerprint);
    for (const changed of [
      { document: buildListingsDocument([], "offer") },
      { recipients: [alice] },
      { relays: [RelayUrl.make("wss://a.example")] },
      { refreshPeriod: 2 },
    ]) {
      expect(
        listingsPublishFingerprint({ ...publication, ...changed }),
      ).not.toBe(fingerprint);
    }
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
    expect(normalizeListingAmount("0", "CZK")).toBe("0");
    expect(normalizeListingAmount(",", "CZK")).toBeNull();
    expect(normalizeListingAmount("1.234", "CZK")).toBeNull();
    expect(normalizeListingAmount("abc", "CZK")).toBeNull();
    expect(normalizeListingAmount("21000", "SAT")).toBe("21000");
    expect(normalizeListingAmount("007", "SAT")).toBe("7");
    expect(normalizeListingAmount("21.5", "SAT")).toBeNull();
  });

  it("stores a bitcoin price as whole sats", () => {
    expect(normalizeListingAmount("0.00123456", "BTC")).toBe("123456");
    expect(normalizeListingAmount("1,5", "BTC")).toBe("150000000");
    expect(normalizeListingAmount("0.000000001", "BTC")).toBeNull();
    expect(normalizeListingAmount("0", "BTC")).toBe("0");
    expect(listingWireCurrency("BTC")).toBe("SAT");
    expect(listingWireCurrency("CZK")).toBe("CZK");
  });

  it("keeps the typed price numeric, with the decimals the unit takes", () => {
    expect(filterListingAmountInput("1 200 Kč", "CZK")).toBe("1200");
    expect(filterListingAmountInput("12,505", "CZK")).toBe("12,50");
    expect(filterListingAmountInput("12.5.3", "EUR")).toBe("12.5");
    expect(filterListingAmountInput("12.50", "SAT")).toBe("12");
    expect(filterListingAmountInput("0.123456789", "BTC")).toBe("0.12345678");
    expect(filterListingAmountInput("abc", "CZK")).toBe("");
  });

  it("offers exactly the enabled display currencies as price units, in cycling order", () => {
    expect(listingPriceUnits(["czk", "btc", "sat", "hidden"])).toEqual([
      "SAT",
      "BTC",
      "CZK",
    ]);
    expect(listingPriceUnits(["eur"])).toEqual(["EUR"]);
    expect(listingPriceUnits(["hidden"])).toEqual(["SAT"]);
  });

  it("prices a new listing in the display unit when it is enabled", () => {
    expect(listingUnitOfDisplay("czk")).toBe("CZK");
    expect(listingUnitOfDisplay("sat")).toBe("SAT");
    expect(listingUnitOfDisplay("btc")).toBe("BTC");
    expect(listingUnitOfDisplay("hidden")).toBeNull();
    expect(defaultListingUnit("czk", ["SAT", "CZK"])).toBe("CZK");
    expect(defaultListingUnit("eur", ["SAT", "CZK"])).toBe("SAT");
    expect(defaultListingUnit("hidden", ["CZK"])).toBe("CZK");
    expect(listingCurrencyLabel("CZK", "cs")).toBe("Kč");
    expect(listingCurrencyLabel("SAT", "cs")).toBe("sat");
    expect(listingCurrencyLabel("BTC", "cs")).toBe("₿");
    expect(listingCurrencyLabel("XXX", "cs")).toBe("XXX");
  });

  it("opens a stored sat price in bitcoin only when sats are not enabled", () => {
    expect(listingPriceInput("123456", "SAT", ["BTC", "CZK"])).toEqual({
      amount: "0.00123456",
      unit: "BTC",
    });
    expect(listingPriceInput("123456", "SAT", ["SAT", "BTC"])).toEqual({
      amount: "123456",
      unit: "SAT",
    });
    expect(listingPriceInput("90", "EUR", ["SAT"])).toEqual({
      amount: "90",
      unit: "EUR",
    });
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
    const price = (
      amount: string,
      currency: string,
      options: DisplayAmountOptions,
    ) =>
      formatListingPrice(
        {
          amount: ListingAmount.make(amount),
          currency: ListingCurrency.make(currency),
        },
        options,
        (key) => key,
      );
    expect(squash(price("90", "CZK", czk))).toBe("90 Kč");
    expect(squash(price("1800", "CZK", czk))).toBe("1 800 Kč");
    expect(price("12.50", "EUR", { ...czk, lang: "en" as const })).toBe(
      "~313 CZK",
    );
    expect(squash(price("2000", "CZK", sat))).toBe("~100 000 sat");
    expect(squash(price("21000", "SAT", sat))).toBe("21 000 sat");
    expect(squash(price("200000", "SAT", czk))).toBe("~4 000 Kč");
    expect(price("5", "XXX", sat)).toContain("5");
    // Without rates the author's price stands.
    expect(squash(price("12.50", "EUR", { ...sat, fiatRates: null }))).toBe(
      "12,50 EUR",
    );
  });

  it("shows a zero price as free, or as by agreement when the author left it open", () => {
    const czk = { displayCurrency: "czk" as const, fiatRates: null };
    const listing = {
      amount: ListingAmount.make("0"),
      currency: ListingCurrency.make("CZK"),
    };
    const t = (key: string) => key;
    expect(formatListingPrice(listing, czk, t)).toBe("listingPriceFree");
    expect(
      formatListingPrice({ ...listing, priceByAgreement: true }, czk, t),
    ).toBe("listingPriceByAgreement");
  });
});
