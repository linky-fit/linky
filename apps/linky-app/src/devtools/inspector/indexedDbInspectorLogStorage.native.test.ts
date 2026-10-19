// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { indexedDbInspectorLogStorage as storage } from "./indexedDbInspectorLogStorage.native";
import type { CollectedInspectorRow } from "./inspectorRows";

const collectedRow = (id: number): CollectedInspectorRow => ({
  at: 1_000 + id,
  channel: "nostr.operation",
  tag: `row-${id}`,
  summary: `row-${id}`,
  links: {},
  payload: { id },
  client: "app-a",
  id,
});

describe("native inspector log storage", () => {
  beforeEach(() => localStorage.clear());

  it("loads appended rows in order, without the deleted ones", async () => {
    await storage.apply({
      appendedRows: [collectedRow(1), collectedRow(2)],
      deletedRows: [],
    });
    await storage.apply({
      appendedRows: [collectedRow(3)],
      deletedRows: [collectedRow(1)],
    });
    expect((await storage.load()).map((row) => row.id)).toEqual([2, 3]);
  });

  it("clears every row", async () => {
    await storage.apply({ appendedRows: [collectedRow(1)], deletedRows: [] });
    await storage.clear();
    expect(await storage.load()).toEqual([]);
    expect(localStorage.length).toBe(0);
  });
});
