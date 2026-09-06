import { describe, expect, it } from "vitest";
import { deriveEvoluServerState } from "../app/lib/evoluServerState";

describe("Evolu relay reachability", () => {
  it("keeps a reachable relay connected when an owner has a sync error", () => {
    expect(
      deriveEvoluServerState({
        evoluHasError: true,
        isOffline: false,
        state: "connected",
        syncOwner: null,
      }),
    ).toMatchObject({
      state: "connected",
      isSynced: false,
      labelKey: "evoluNotSynced",
    });
  });

  it("keeps explicitly disabled relays offline", () => {
    expect(
      deriveEvoluServerState({
        evoluHasError: false,
        isOffline: true,
        state: "connected",
        syncOwner: null,
      }),
    ).toMatchObject({
      state: "disconnected",
      labelKey: "evoluServerOfflineStatus",
    });
  });
});
