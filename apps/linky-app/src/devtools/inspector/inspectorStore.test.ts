import { describe, expect, it } from "vitest";

import type { InspectorRow } from "./inspectorRows";
import { createInspectorStore } from "./inspectorStore";

const row = (tag: string, channel: string = "nostr.wire"): InspectorRow => ({
  at: 1_700_000_000_000,
  channel,
  tag,
  summary: `summary of ${tag}`,
  links: {},
  payload: { tag },
});

describe("createInspectorStore", () => {
  it("assigns monotonically increasing ids across batches and clients", () => {
    const store = createInspectorStore();

    const first = store.append("tab-a", [row("one"), row("two")]);
    const second = store.append("tab-b", [row("three")]);

    expect(first.map((entry) => entry.id)).toEqual([1, 2]);
    expect(second.map((entry) => entry.id)).toEqual([3]);
    expect(first.map((entry) => entry.client)).toEqual(["tab-a", "tab-a"]);
    expect(second[0]?.client).toBe("tab-b");
  });

  it("evicts the oldest rows once the ring buffer is full", () => {
    const store = createInspectorStore(3);

    store.append("tab", [row("one"), row("two")]);
    store.append("tab", [row("three"), row("four")]);

    const { rows } = store.query();
    expect(rows.map((entry) => entry.tag)).toEqual(["two", "three", "four"]);
    expect(rows.map((entry) => entry.id)).toEqual([2, 3, 4]);
  });

  it("returns only rows after the cursor and a cursor that resumes cleanly", () => {
    const store = createInspectorStore();
    store.append("tab", [row("one"), row("two"), row("three")]);

    const firstPage = store.query({ cursor: 0 });
    expect(firstPage.rows).toHaveLength(3);
    expect(firstPage.cursor).toBe(3);

    const secondPage = store.query({ cursor: firstPage.cursor });
    expect(secondPage.rows).toHaveLength(0);
    expect(secondPage.cursor).toBe(3);

    store.append("tab", [row("four")]);
    const thirdPage = store.query({ cursor: secondPage.cursor });
    expect(thirdPage.rows.map((entry) => entry.tag)).toEqual(["four"]);
  });

  it("resumes from the last returned row when a page is truncated by limit", () => {
    const store = createInspectorStore();
    store.append("tab", [row("one"), row("two"), row("three")]);

    const firstPage = store.query({ limit: 2 });
    expect(firstPage.rows.map((entry) => entry.tag)).toEqual(["one", "two"]);
    expect(firstPage.cursor).toBe(2);

    const secondPage = store.query({ cursor: firstPage.cursor, limit: 2 });
    expect(secondPage.rows.map((entry) => entry.tag)).toEqual(["three"]);
    expect(secondPage.cursor).toBe(3);
  });

  it("filters by channel", () => {
    const store = createInspectorStore();
    store.append("tab", [
      row("react", "nostr.operation"),
      row("published", "nostr.wire"),
      row("routed", "nostr.operation"),
    ]);

    const operations = store.query({ channel: "nostr.operation" });
    expect(operations.rows.map((entry) => entry.tag)).toEqual([
      "react",
      "routed",
    ]);
    expect(operations.cursor).toBe(3);
  });

  it("filters by client", () => {
    const store = createInspectorStore();
    store.append("tab-a", [row("from-a")]);
    store.append("tab-b", [row("from-b")]);

    const { rows } = store.query({ client: "tab-b" });
    expect(rows.map((entry) => entry.tag)).toEqual(["from-b"]);
  });

  it("keeps ids increasing after clear so poller cursors stay valid", () => {
    const store = createInspectorStore();
    store.append("tab", [row("one"), row("two")]);

    store.clear();
    expect(store.query().rows).toHaveLength(0);

    const appended = store.append("tab", [row("three")]);
    expect(appended[0]?.id).toBe(3);
    expect(store.query({ cursor: 2 }).rows.map((entry) => entry.tag)).toEqual([
      "three",
    ]);
  });
});
