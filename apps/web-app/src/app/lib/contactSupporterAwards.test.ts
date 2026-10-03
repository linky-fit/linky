import { beforeEach, describe, expect, it, vi } from "vitest";

const NPUB = "npub1contact";

const loadStore = async () => {
  vi.resetModules();
  return import("./contactSupporterAwards");
};

describe("contactSupporterAwards", () => {
  beforeEach(() => localStorage.clear());

  it("keeps newer awards in memory and in the cache, and notifies", async () => {
    const store = await loadStore();
    const listener = vi.fn();
    store.subscribeContactSupporterAwards(listener);

    store.applySupporterBadgesUpdated(NPUB, {
      awards: [{ badge: "gold", awardedAt: 100 }],
      updatedAt: 200,
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(store.getContactSupporterAwards(NPUB)).toEqual([
      { badge: "gold", awardedAt: 100 },
    ]);
    expect((await loadStore()).getContactSupporterAwards(NPUB)).toEqual([
      { badge: "gold", awardedAt: 100 },
    ]);
  });

  it("ignores a profile badges event that is not newer", async () => {
    const store = await loadStore();
    store.applySupporterBadgesUpdated(NPUB, {
      awards: [{ badge: "gold", awardedAt: 100 }],
      updatedAt: 200,
    });

    store.applySupporterBadgesUpdated(NPUB, { awards: [], updatedAt: 200 });

    expect(store.getContactSupporterAwards(NPUB)).toHaveLength(1);
  });

  it("drops the badges once the contact withdraws them", async () => {
    const store = await loadStore();
    store.applySupporterBadgesUpdated(NPUB, {
      awards: [{ badge: "gold", awardedAt: 100 }],
      updatedAt: 200,
    });

    store.applySupporterBadgesUpdated(NPUB, { awards: [], updatedAt: 300 });

    expect(store.getContactSupporterAwards(NPUB)).toEqual([]);
  });
});
