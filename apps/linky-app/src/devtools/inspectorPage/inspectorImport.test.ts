import { describe, expect, it } from "vitest";

import type { CollectedInspectorRow } from "../inspector/inspectorRows";
import { INSPECTOR_MAX_ROWS } from "../inspector/inspectorStore";
import { parseInspectorNdjson } from "./inspectorImport";

const row = (id: number): CollectedInspectorRow => ({
  id,
  client: id % 2 === 0 ? "tab-b" : "tab-a",
  at: 1_700_000_000_000 + id,
  channel: id % 2 === 0 ? "nostr.wire" : "nostr.operation",
  tag: `row-${id}`,
  summary: `summary ${id}`,
  links: { client: `client-${id}` },
  payload: { id },
});

describe("parseInspectorNdjson", () => {
  it("parses collected rows and skips blank lines", () => {
    const result = parseInspectorNdjson(
      `${JSON.stringify(row(1))}\n\n${JSON.stringify(row(2))}\n`,
    );

    expect(result.rows).toEqual([row(1), row(2)]);
    expect(result.skippedLineCount).toBe(0);
    expect(result.truncatedRowCount).toBe(0);
  });

  it("skips and counts malformed JSON and invalid rows", () => {
    const result = parseInspectorNdjson(
      [`{"broken"`, JSON.stringify({ ...row(1), client: 42 }), "  "].join("\n"),
    );

    expect(result.rows).toEqual([]);
    expect(result.skippedLineCount).toBe(2);
  });

  it("keeps the newest rows in id order when the cap is exceeded", () => {
    const inputRows = Array.from(
      { length: INSPECTOR_MAX_ROWS + 2 },
      (_, index) => row(INSPECTOR_MAX_ROWS + 2 - index),
    );
    const result = parseInspectorNdjson(
      inputRows.map((entry) => JSON.stringify(entry)).join("\n"),
    );

    expect(result.rows).toHaveLength(INSPECTOR_MAX_ROWS);
    expect(result.rows[0]?.id).toBe(3);
    expect(result.rows.at(-1)?.id).toBe(INSPECTOR_MAX_ROWS + 2);
    expect(result.truncatedRowCount).toBe(2);
  });
});
