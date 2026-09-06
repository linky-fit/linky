import { Schema } from "effect";
import { JsonValue } from "../types/json";
import { asRecord, isHttpUrl } from "./validation";

/**
 * Upstream npub.cash (v2 API) holds no proofs. It lists the mint quotes it
 * created for the owner's address and which of them were paid; the wallet
 * mints those itself. This is the read side of that sweep: the listing
 * request, its lenient parse, and the cursor/ledger that keeps it idempotent.
 */

export interface UpstreamPaidQuote {
  readonly quoteId: string;
  readonly mint: string;
  readonly amountSat: number;
  readonly invoice: string;
  readonly paidAt: number;
  readonly expiresAt: number | null;
  readonly locked: boolean;
}

export interface UpstreamQuotesPage {
  /** Quotes the server marks PAID, in listing order; malformed entries are skipped. */
  readonly paid: readonly UpstreamPaidQuote[];
  /** Entries in the page, paid or not. */
  readonly count: number;
  readonly total: number | null;
}

/** The server caps `limit` at 50 regardless of what is asked. */
export const UPSTREAM_QUOTES_PAGE_SIZE = 50;
const MAX_PAGES_PER_SWEEP = 20;

const asPositiveInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;

const asTrimmed = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const parseQuote = (value: JsonValue): UpstreamPaidQuote | null => {
  const quote = asRecord(value);
  if (!quote || quote.state !== "PAID") return null;
  const quoteId = asTrimmed(quote.quoteId);
  const mint = asTrimmed(quote.mintUrl).replace(/\/+$/, "");
  const amountSat = asPositiveInt(quote.amount);
  const invoice = asTrimmed(quote.request);
  const paidAt = asPositiveInt(quote.paidAt);
  if (
    !quoteId ||
    !isHttpUrl(mint) ||
    amountSat === null ||
    !invoice.toLowerCase().startsWith("ln") ||
    paidAt === null
  ) {
    return null;
  }
  return {
    quoteId,
    mint,
    amountSat,
    invoice,
    paidAt,
    expiresAt: asPositiveInt(quote.expiresAt),
    locked: quote.locked === true,
  };
};

export const parseUpstreamQuotesPage = (
  json: JsonValue,
): UpstreamQuotesPage | null => {
  const root = asRecord(json);
  if (!root || root.error) return null;
  const list = asRecord(root.data)?.quotes;
  if (!Array.isArray(list)) return null;
  const paid: UpstreamPaidQuote[] = [];
  for (const item of list) {
    const quote = parseQuote(item);
    if (quote) paid.push(quote);
  }
  const total = asRecord(root.metadata)?.total;
  return {
    paid,
    count: list.length,
    total: typeof total === "number" ? total : null,
  };
};

export interface UpstreamQuotesRequest {
  /** What NIP-98 signs: the server checks the path without the query. */
  readonly signUrl: string;
  readonly url: string;
}

export const upstreamQuotesRequest = (
  baseUrl: string,
  since: number | null,
  offset: number,
): UpstreamQuotesRequest => {
  const signUrl = `${baseUrl}/api/v2/wallet/quotes`;
  const params = new URLSearchParams({
    limit: String(UPSTREAM_QUOTES_PAGE_SIZE),
    offset: String(offset),
  });
  if (since !== null) params.set("since", String(since));
  return { signUrl, url: `${signUrl}?${params.toString()}` };
};

export interface UpstreamPaidQuotesListing {
  readonly paid: readonly UpstreamPaidQuote[];
  /** False when the sweep hit its page cap before the listing ended. */
  readonly complete: boolean;
}

export const listUpstreamPaidQuotes = async (args: {
  baseUrl: string;
  since: number | null;
  makeNip98AuthHeader: (url: string, method: string) => Promise<string>;
}): Promise<UpstreamPaidQuotesListing | null> => {
  const paid: UpstreamPaidQuote[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES_PER_SWEEP; page += 1) {
    const request = upstreamQuotesRequest(args.baseUrl, args.since, offset);
    const auth = await args.makeNip98AuthHeader(request.signUrl, "GET");
    const res = await fetch(request.url, {
      method: "GET",
      headers: { Authorization: auth },
    });
    if (!res.ok) return null;
    const parsed = parseUpstreamQuotesPage(
      Schema.decodeUnknownSync(JsonValue)(await res.json()),
    );
    if (parsed === null) return null;
    paid.push(...parsed.paid);
    offset += parsed.count;
    const listingEnded =
      parsed.count === 0 ||
      parsed.count < UPSTREAM_QUOTES_PAGE_SIZE ||
      (parsed.total !== null && offset >= parsed.total);
    if (listingEnded) return { paid, complete: true };
  }
  return { paid, complete: false };
};

/**
 * The server filters on `paid_at > since`, so the cursor trails the newest
 * settled payment by a lookback: a quote paid in the same second, or listed
 * late, is still returned next time, and the ledger of ids inside the window
 * stops it from being minted twice. Ids older than the window need no ledger.
 */
export const UPSTREAM_QUOTE_LOOKBACK_SEC = 10 * 60;
const MAX_LEDGER_ENTRIES = 1000;

export interface SettledUpstreamQuote {
  readonly quoteId: string;
  readonly paidAt: number;
}

export interface UpstreamQuoteLedger {
  readonly since: number | null;
  readonly settled: readonly SettledUpstreamQuote[];
}

export const EMPTY_UPSTREAM_QUOTE_LEDGER: UpstreamQuoteLedger = {
  since: null,
  settled: [],
};

export const parseUpstreamQuoteLedger = (
  raw: string | null,
): UpstreamQuoteLedger => {
  if (!raw) return EMPTY_UPSTREAM_QUOTE_LEDGER;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return EMPTY_UPSTREAM_QUOTE_LEDGER;
    }
    const since = Reflect.get(parsed, "since");
    const list = Reflect.get(parsed, "settled");
    const settled: SettledUpstreamQuote[] = [];
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (typeof entry !== "object" || entry === null) continue;
        const quoteId = asTrimmed(Reflect.get(entry, "quoteId"));
        const paidAt = asPositiveInt(Reflect.get(entry, "paidAt"));
        if (quoteId && paidAt !== null) settled.push({ quoteId, paidAt });
      }
    }
    return { since: asPositiveInt(since), settled };
  } catch {
    return EMPTY_UPSTREAM_QUOTE_LEDGER;
  }
};

export const isUpstreamQuoteSettled = (
  ledger: UpstreamQuoteLedger,
  quoteId: string,
): boolean => ledger.settled.some((entry) => entry.quoteId === quoteId);

/**
 * Records the quotes this sweep finished with. The cursor only moves when
 * the listing was read to its end: on a capped listing the unread pages
 * may hold older paid quotes the cursor would otherwise skip forever.
 */
export const settleUpstreamQuotes = (
  ledger: UpstreamQuoteLedger,
  settled: readonly SettledUpstreamQuote[],
  listingComplete: boolean,
): UpstreamQuoteLedger => {
  const all = [...ledger.settled, ...settled];
  const newestPaidAt = Math.max(
    ledger.since === null ? 0 : ledger.since + UPSTREAM_QUOTE_LOOKBACK_SEC,
    ...all.map((entry) => entry.paidAt),
  );
  const since =
    listingComplete && newestPaidAt > 0
      ? newestPaidAt - UPSTREAM_QUOTE_LOOKBACK_SEC
      : ledger.since;
  return {
    since,
    settled: all
      .filter((entry) => since === null || entry.paidAt > since)
      .slice(-MAX_LEDGER_ENTRIES),
  };
};
