import { describe, expect, it, vi } from "vitest";

import type { InspectorRow } from "../inspector/inspectorRows";
import { createInspectorStore } from "../inspector/inspectorStore";
import {
  createInMemoryInspectorDataSource,
  createStaticInspectorDataSource,
} from "./inspectorDataSource";

const row = (tag: string): InspectorRow => ({
  at: 1_700_000_000_000,
  channel: "nostr.wire",
  tag,
  summary: tag,
  links: {},
  payload: { tag },
});

describe("createInMemoryInspectorDataSource", () => {
  it("replays buffered rows and streams appends and clears", async () => {
    const store = createInspectorStore();
    store.append("tab", [row("buffered")]);
    const source = createInMemoryInspectorDataSource(store);
    const receivedTags: string[] = [];
    const onClear = vi.fn();
    const onConnectionChange = vi.fn();

    const disconnect = source.connect({
      onClear,
      onConnectionChange,
      onRows: (rows) => {
        receivedTags.push(...rows.map((entry) => entry.tag));
      },
    });

    store.append("tab", [row("live")]);
    await source.clear();

    expect(onConnectionChange).toHaveBeenCalledWith(true);
    expect(receivedTags).toEqual(["buffered", "live"]);
    expect(onClear).toHaveBeenCalledOnce();
    expect(store.query().rows).toEqual([]);

    disconnect();
    store.append("tab", [row("disconnected")]);
    expect(receivedTags).toEqual(["buffered", "live"]);
  });
});

describe("createStaticInspectorDataSource", () => {
  it("replays a sorted snapshot and clears it without external effects", async () => {
    const store = createInspectorStore();
    const first = store.append("tab-a", [row("first")])[0];
    const second = store.append("tab-b", [row("second")])[0];
    if (!first || !second) throw new Error("Expected fixture rows");

    const source = createStaticInspectorDataSource([second, first]);
    const receivedIds: number[] = [];
    const onClear = vi.fn();
    const onConnectionChange = vi.fn();
    const disconnect = source.connect({
      onClear,
      onConnectionChange,
      onRows: (rows) => receivedIds.push(...rows.map((entry) => entry.id)),
    });

    expect(receivedIds).toEqual([first.id, second.id]);
    expect(onConnectionChange).toHaveBeenCalledWith(true);

    await source.clear();
    expect(onClear).toHaveBeenCalledOnce();

    disconnect();
    const afterClear = vi.fn();
    source.connect({
      onClear: vi.fn(),
      onConnectionChange: vi.fn(),
      onRows: afterClear,
    });
    expect(afterClear).toHaveBeenCalledWith([]);
  });
});
