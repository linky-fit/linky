import { describe, expect, it } from "vitest";
import { deriveEvoluRelayState } from "../app/lib/evoluRelayState";

describe("Evolu relay reachability", () => {
  it("keeps a reachable relay connected when an owner has a sync error", () => {
    expect(
      deriveEvoluRelayState({
        evoluHasError: true,
        isOffline: false,
        state: "connected",
        syncOwnerId: null,
      }),
    ).toMatchObject({
      state: "connected",
      isSynced: false,
      labelKey: "evoluNotSynced",
    });
  });

  it("keeps explicitly disabled relays offline", () => {
    expect(
      deriveEvoluRelayState({
        evoluHasError: false,
        isOffline: true,
        state: "connected",
        syncOwnerId: null,
      }),
    ).toMatchObject({
      state: "disconnected",
      labelKey: "evoluRelayOfflineStatus",
    });
  });
});
