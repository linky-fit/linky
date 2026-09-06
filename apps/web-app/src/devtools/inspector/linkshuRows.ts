import type { LinkshuInspectorEvent } from "@linky/linkshu";
import type { InspectorRow } from "./inspectorRows";
import { isRecord } from "../../utils/unknown";

const short = (id: string): string =>
  id.length > 9 ? `${id.slice(0, 8)}…` : id;

const errorTag = (error: unknown): string | null =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  typeof error._tag === "string"
    ? error._tag
    : null;

const MAX_ID_SCAN_DEPTH = 3;

// Operation params/results are linkshu's shapes; a shallow key scan lifts the
// correlating ids wherever they sit (rowId, receipt.rowId, quoteId, …).
const scanForLinkIds = (
  value: unknown,
  depth: number,
  out: { row: Set<string>; quote: Set<string> },
): void => {
  if (depth > MAX_ID_SCAN_DEPTH) return;
  if (Array.isArray(value)) {
    for (const entry of value) scanForLinkIds(entry, depth + 1, out);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && entry.length > 0) {
      if (key === "rowId") out.row.add(entry);
      else if (
        key === "quoteId" ||
        key === "meltQuoteId" ||
        key === "mintQuoteId"
      ) {
        out.quote.add(entry);
      }
    } else {
      scanForLinkIds(entry, depth + 1, out);
    }
  }
};

const operationLinks = (params: unknown, result: unknown) => {
  const found = { row: new Set<string>(), quote: new Set<string>() };
  scanForLinkIds(params, 0, found);
  scanForLinkIds(result, 0, found);
  return {
    ...(found.row.size > 0 ? { row: [...found.row] } : {}),
    ...(found.quote.size > 0 ? { quote: [...found.quote] } : {}),
  };
};

export const linkshuEventToRow = (
  event: LinkshuInspectorEvent,
  at: number,
): InspectorRow => {
  switch (event._tag) {
    case "OperationSucceeded":
      return {
        at,
        channel: "cashu",
        tag: event.name,
        summary: event.name,
        links: operationLinks(event.params, event.result),
        payload: event,
      };
    case "OperationFailed": {
      const reason = errorTag(event.error);
      return {
        at,
        channel: "cashu",
        tag: event.name,
        summary: `${event.name} — failed${reason === null ? "" : `: ${reason}`}`,
        links: operationLinks(event.params, event.error),
        payload: event,
      };
    }
    case "TokenLifecycleChanged":
      return {
        at,
        channel: "cashu",
        tag: event._tag,
        summary: `token ${short(event.rowId)} ${event.from ?? "(new)"} → ${event.to} (${event.reason})`,
        links: { row: event.rowId },
        payload: event,
      };
    case "CounterAdvanced":
      return {
        at,
        channel: "cashu",
        tag: event._tag,
        summary: `counter ${event.keysetId} ${event.from} → ${event.to} (${event.reason})`,
        links: { keyset: event.keysetId },
        context: { mint: event.mint, unit: event.unit },
        payload: event,
      };
    case "QuoteStateChanged":
      return {
        at,
        channel: "cashu",
        tag: event._tag,
        summary: `${event.flow} quote ${short(event.quoteId)} → ${event.state}`,
        links: { quote: event.quoteId },
        context: { mint: event.mint },
        payload: event,
      };
    case "LightningFeeProbed":
      return {
        at,
        channel: "cashu",
        tag: event._tag,
        summary: `${event.mint} melt fee_reserve ${event.feeReserve} sat on ${event.amount} sat (${event.percent.toFixed(2)} %)`,
        links: { meltQuote: event.meltQuoteId, mintQuote: event.mintQuoteId },
        context: { mint: event.mint, probeMint: event.probeMint },
        payload: event,
      };
  }
};
