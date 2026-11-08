import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_UPSTREAM_QUOTE_LEDGER,
  isUpstreamQuoteSettled,
  listUpstreamPaidQuotes,
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

describe("listUpstreamPaidQuotes", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A listing of `total` paid quotes, served in pages of 50. */
  const stubListing = (total: number): string[] => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        const offset = Number(new URL(url).searchParams.get("offset"));
        const count = Math.max(0, Math.min(50, total - offset));
        const quotes = Array.from({ length: count }, (_, index) =>
          quote({ quoteId: `q-${offset + index}` }),
        );
        return Response.json({
          error: false,
          data: { quotes },
          metadata: { total },
        });
      }),
    );
    return urls;
  };

  const list = (offset: number) =>
    listUpstreamPaidQuotes({
      baseUrl: "https://npub.linky.fit",
      since: null,
      offset,
      makeNip98AuthHeader: async () => "Nostr auth",
    });

  it("stops at its page cap with the offset to resume from, then reads the rest", async () => {
    const urls = stubListing(1_020);

    const capped = await list(0);
    expect(capped?.paid).toHaveLength(1_000);
    expect(capped?.nextOffset).toBe(1_000);

    const rest = await list(1_000);
    expect(rest?.paid.map((paid) => paid.quoteId)).toEqual(
      Array.from({ length: 20 }, (_, index) => `q-${1_000 + index}`),
    );
    expect(rest?.nextOffset).toBeNull();
    expect(urls).toHaveLength(21);
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
      null,
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
      { since: paidAt, offset: 0, settled: [] },
      [{ quoteId: "late", paidAt: paidAt + 10 }],
      null,
    );
    expect(ledger.since).toBe(paidAt);
    expect(ledger.settled).toEqual([{ quoteId: "late", paidAt: paidAt + 10 }]);
  });

  it("holds the cursor and resumes past the read entries when the listing was cut short", () => {
    const ledger = settleUpstreamQuotes(
      { since: paidAt - 3600, offset: 0, settled: [] },
      [{ quoteId: "q", paidAt }],
      1000,
    );
    expect(ledger).toMatchObject({ since: paidAt - 3600, offset: 1000 });
    expect(isUpstreamQuoteSettled(ledger, "q")).toBe(true);

    const finished = settleUpstreamQuotes(
      ledger,
      [{ quoteId: "older", paidAt: paidAt - 1800 }],
      null,
    );
    expect(finished).toMatchObject({
      since: paidAt - UPSTREAM_QUOTE_LOOKBACK_SEC,
      offset: 0,
    });
  });

  it("round-trips through storage and tolerates junk", () => {
    const ledger = settleUpstreamQuotes(
      EMPTY_UPSTREAM_QUOTE_LEDGER,
      [{ quoteId: "q", paidAt }],
      50,
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
