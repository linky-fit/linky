import { describe, expect, it } from "vitest";
import {
  EMPTY_UPSTREAM_QUOTE_LEDGER,
  isUpstreamQuoteSettled,
  parseUpstreamQuoteLedger,
  parseUpstreamQuotesPage,
  settleUpstreamQuotes,
  UPSTREAM_QUOTE_LOOKBACK_SEC,
  upstreamQuotesRequest,
} from "./npubCashUpstreamQuotes";

const quote = (overrides: Record<string, unknown> = {}) => ({
  createdAt: 1_700_000_000,
  paidAt: 1_700_000_100,
  expiresAt: 1_700_003_600,
  mintUrl: "https://mint.minibits.cash/Bitcoin/",
  quoteId: "q-1",
  request: "lnbc210n1example",
  amount: 21,
  state: "PAID",
  locked: false,
  ...overrides,
});

describe("parseUpstreamQuotesPage", () => {
  it("keeps paid quotes, normalizes the mint url, and reports the page shape", () => {
    const page = parseUpstreamQuotesPage({
      error: false,
      data: {
        quotes: [
          quote(),
          quote({ quoteId: "q-2", state: "ISSUED" }),
          quote({ quoteId: "q-3", state: "INFLIGHT" }),
          quote({ quoteId: "q-4", locked: true, expiresAt: null }),
        ],
      },
      metadata: { total: 7, limit: 50 },
    });
    expect(page).toEqual({
      paid: [
        {
          quoteId: "q-1",
          mint: "https://mint.minibits.cash/Bitcoin",
          amountSat: 21,
          invoice: "lnbc210n1example",
          paidAt: 1_700_000_100,
          expiresAt: 1_700_003_600,
          locked: false,
        },
        {
          quoteId: "q-4",
          mint: "https://mint.minibits.cash/Bitcoin",
          amountSat: 21,
          invoice: "lnbc210n1example",
          paidAt: 1_700_000_100,
          expiresAt: null,
          locked: true,
        },
      ],
      count: 4,
      total: 7,
    });
  });

  it("skips paid entries that cannot be minted from", () => {
    const page = parseUpstreamQuotesPage({
      error: false,
      data: {
        quotes: [
          quote({ quoteId: "" }),
          quote({ mintUrl: "not a url" }),
          quote({ amount: 0 }),
          quote({ request: "bc1qnotaninvoice" }),
          quote({ paidAt: null }),
        ],
      },
    });
    expect(page).toEqual({ paid: [], count: 5, total: null });
  });

  it("rejects error and malformed responses", () => {
    expect(
      parseUpstreamQuotesPage({ error: true, message: "nope" }),
    ).toBeNull();
    expect(parseUpstreamQuotesPage({ error: false, data: {} })).toBeNull();
    expect(parseUpstreamQuotesPage("<!doctype html>")).toBeNull();
  });
});

describe("upstreamQuotesRequest", () => {
  it("signs the bare path and sends the query", () => {
    expect(
      upstreamQuotesRequest("https://npub.cash", 1_700_000_000, 100),
    ).toEqual({
      signUrl: "https://npub.cash/api/v2/wallet/quotes",
      url: "https://npub.cash/api/v2/wallet/quotes?limit=50&offset=100&since=1700000000",
    });
    expect(upstreamQuotesRequest("https://npub.cash", null, 0).url).toBe(
      "https://npub.cash/api/v2/wallet/quotes?limit=50&offset=0",
    );
  });
});

describe("upstream quote ledger", () => {
  const paidAt = 1_700_000_000;

  it("trails the newest settled payment by the lookback and keeps ids inside it", () => {
    const ledger = settleUpstreamQuotes(
      EMPTY_UPSTREAM_QUOTE_LEDGER,
      [
        { quoteId: "old", paidAt: paidAt - 2 * UPSTREAM_QUOTE_LOOKBACK_SEC },
        { quoteId: "recent", paidAt: paidAt - 60 },
        { quoteId: "newest", paidAt },
      ],
      true,
    );
    expect(ledger.since).toBe(paidAt - UPSTREAM_QUOTE_LOOKBACK_SEC);
    expect(ledger.settled.map((entry) => entry.quoteId)).toEqual([
      "recent",
      "newest",
    ]);
    expect(isUpstreamQuoteSettled(ledger, "newest")).toBe(true);
    expect(isUpstreamQuoteSettled(ledger, "old")).toBe(false);
  });

  it("never moves the cursor backwards", () => {
    const ledger = settleUpstreamQuotes(
      { since: paidAt, settled: [] },
      [{ quoteId: "late", paidAt: paidAt + 10 }],
      true,
    );
    expect(ledger.since).toBe(paidAt);
    expect(ledger.settled).toEqual([{ quoteId: "late", paidAt: paidAt + 10 }]);
  });

  it("holds the cursor when the listing was cut short", () => {
    const ledger = settleUpstreamQuotes(
      { since: paidAt - 3600, settled: [] },
      [{ quoteId: "q", paidAt }],
      false,
    );
    expect(ledger.since).toBe(paidAt - 3600);
    expect(isUpstreamQuoteSettled(ledger, "q")).toBe(true);
  });

  it("round-trips through storage and tolerates junk", () => {
    const ledger = settleUpstreamQuotes(
      EMPTY_UPSTREAM_QUOTE_LEDGER,
      [{ quoteId: "q", paidAt }],
      true,
    );
    expect(parseUpstreamQuoteLedger(JSON.stringify(ledger))).toEqual(ledger);
    expect(parseUpstreamQuoteLedger(null)).toEqual(EMPTY_UPSTREAM_QUOTE_LEDGER);
    expect(parseUpstreamQuoteLedger("{")).toEqual(EMPTY_UPSTREAM_QUOTE_LEDGER);
    expect(
      parseUpstreamQuoteLedger(
        JSON.stringify({ since: "x", settled: [{ quoteId: "q" }, 1, null] }),
      ),
    ).toEqual(EMPTY_UPSTREAM_QUOTE_LEDGER);
  });
});
