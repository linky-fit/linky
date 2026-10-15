import { describe, expect, it } from "vitest";

import { parseInspectorNdjson } from "../inspectorPage/inspectorImport";
import type { CollectedInspectorRow, InspectorRow } from "./inspectorRows";
import {
  appendPersistentInspectorLogRows,
  createPersistentInspectorLogState,
  getPersistentInspectorLogRows,
  inspectorLogRowSize,
  serializeInspectorLogsNdjson,
} from "./persistentInspectorLogBuffer";

const NOW = 1_800_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

const row = (at: number, tag: string): InspectorRow => ({
  at,
  channel: "nostr.operation",
  tag,
  summary: tag,
  links: {},
  payload: { tag },
});

const collectedRow = (id: number, at: number): CollectedInspectorRow => ({
  ...row(at, `row-${id}`),
  client: "tab-a",
  id,
});

describe("persistent inspector log buffer", () => {
  it("prunes rows older than 24 hours on initialization", () => {
    const expired = collectedRow(1, NOW - DAY_MS - 1);
    const boundary = collectedRow(2, NOW - DAY_MS);
    const initialized = createPersistentInspectorLogState(
      [boundary, expired],
      NOW,
    );

    expect(getPersistentInspectorLogRows(initialized.state)).toEqual([
      boundary,
    ]);
    expect(initialized.deletedRows).toEqual([expired]);
    expect(initialized.state.nextId).toBe(3);
  });

  it("assigns monotonic ids, preserves order, and accounts for row size", () => {
    const initialized = createPersistentInspectorLogState([], NOW);
    const appended = appendPersistentInspectorLogRows(
      initialized.state,
      [
        { client: "tab-a", row: row(NOW, "first") },
        { client: "tab-a", row: row(NOW + 1, "second") },
      ],
      NOW + 1,
    );
    const rows = getPersistentInspectorLogRows(appended.state);

    expect(rows.map((entry) => entry.id)).toEqual([1, 2]);
    expect(rows.map((entry) => entry.tag)).toEqual(["first", "second"]);
    expect(appended.state.totalSize).toBe(
      rows.reduce((total, entry) => total + inspectorLogRowSize(entry), 0),
    );
  });

  it("removes the oldest rows first when the byte ceiling is exceeded", () => {
    const initial = createPersistentInspectorLogState([], NOW).state;
    const uncapped = appendPersistentInspectorLogRows(
      initial,
      [
        { client: "tab-a", row: row(NOW, "first") },
        { client: "tab-a", row: row(NOW + 1, "second") },
        { client: "tab-a", row: row(NOW + 2, "third") },
      ],
      NOW + 2,
      { maxAgeMs: DAY_MS, maxSize: Number.MAX_SAFE_INTEGER },
    );
    const allRows = getPersistentInspectorLogRows(uncapped.state);
    const lastTwoSize = allRows
      .slice(1)
      .reduce((total, entry) => total + inspectorLogRowSize(entry), 0);
    const capped = appendPersistentInspectorLogRows(
      initial,
      [
        { client: "tab-a", row: row(NOW, "first") },
        { client: "tab-a", row: row(NOW + 1, "second") },
        { client: "tab-a", row: row(NOW + 2, "third") },
      ],
      NOW + 2,
      { maxAgeMs: DAY_MS, maxSize: lastTwoSize },
    );

    expect(
      getPersistentInspectorLogRows(capped.state).map((entry) => entry.tag),
    ).toEqual(["second", "third"]);
    expect(capped.state.totalSize).toBe(lastTwoSize);
  });

  it("serializes ordered, newline-terminated ndjson that imports cleanly", () => {
    const rows = [collectedRow(2, NOW + 1), collectedRow(1, NOW)];
    const ndjson = serializeInspectorLogsNdjson(rows);
    const imported = parseInspectorNdjson(ndjson);

    expect(ndjson.endsWith("\n")).toBe(true);
    expect(imported.skippedLineCount).toBe(0);
    expect(imported.truncatedRowCount).toBe(0);
    expect(imported.rows).toEqual([rows[1], rows[0]]);
  });

  it("round-trips novel channels and link labels unchanged", () => {
    const cashuRow: CollectedInspectorRow = {
      id: 1,
      client: "tab-cashu",
      at: NOW,
      channel: "cashu.wire",
      tag: "QuoteCreated",
      summary: "created mint quote",
      links: { quote: "quote-1", proof: ["proof-1", "proof-2"] },
      context: { mint: "https://mint.test" },
      payload: { amount: 21 },
    };

    const imported = parseInspectorNdjson(
      serializeInspectorLogsNdjson([cashuRow]),
    );

    expect(imported.rows).toEqual([cashuRow]);
    expect(imported.skippedLineCount).toBe(0);
  });
});
