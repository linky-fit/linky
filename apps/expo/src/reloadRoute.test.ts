import { describe, expect, it } from "bun:test";
import type { KeyValueStorage } from "@linky-fit/linksync/evolu";
import { keepReloadRoute, takeReloadRoute } from "./reloadRoute";

const memoryKv = (): KeyValueStorage => {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
};

describe("reload route handoff", () => {
  it("hands the route to the next run once", () => {
    const kv = memoryKv();
    keepReloadRoute(kv, "chat/abc");
    expect(takeReloadRoute(kv)).toBe("chat/abc");
    expect(takeReloadRoute(kv)).toBeNull();
  });

  it("has nothing to hand over on a plain start", () => {
    expect(takeReloadRoute(memoryKv())).toBeNull();
  });
});
