import { createBoltCard, serializeBoltCard } from "@linky-fit/bolt-card";
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  secrets: new Map<string, string>(),
  reads: 0,
}));

vi.mock("../../platform/nativeBridge", () => ({
  readAndroidStoredSecret: async (key: string) => {
    native.reads += 1;
    return native.secrets.get(key);
  },
  writeAndroidStoredSecret: async (key: string, value: string) => {
    native.secrets.set(key, value);
    return true;
  },
  removeAndroidStoredSecret: async (key: string) => native.secrets.delete(key),
}));

import {
  loadBoltCard,
  loadOrCreateBoltCard,
  removeBoltCard,
  saveBoltCard,
} from "./boltCardStorage";

describe("bolt card storage", () => {
  beforeEach(async () => {
    await removeBoltCard();
    native.secrets = new Map();
    native.reads = 0;
  });

  it("reads the native store once and serves later loads from memory", async () => {
    const stored = { ...createBoltCard(), counter: 3 };
    native.secrets.set("linky.bolt_card.v1", serializeBoltCard(stored));

    await loadBoltCard();
    expect(await loadOrCreateBoltCard()).toEqual(stored);
    expect(native.reads).toBe(1);
  });

  it("keeps the counter of the last saved card", async () => {
    const card = await loadOrCreateBoltCard();
    if (!card) throw new Error("no card");
    await saveBoltCard({ ...card, counter: 7 });
    expect((await loadBoltCard())?.counter).toBe(7);
  });

  it("forgets the cached card when the card is replaced", async () => {
    const first = await loadOrCreateBoltCard();
    await removeBoltCard();
    const second = await loadOrCreateBoltCard();
    expect(second?.k1).not.toEqual(first?.k1);
  });
});
