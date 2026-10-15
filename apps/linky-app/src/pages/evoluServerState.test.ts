import { describe, expect, it } from "vitest";
import { deriveEvoluServerState } from "../app/lib/evoluServerState";

describe("Evolu relay reachability", () => {
  it("keeps a reachable relay apart from an unreachable one when an owner has a sync error", () => {
    expect(
      deriveEvoluServerState({
        evoluHasError: true,
        isOffline: false,
        state: "connected",
        syncOwnerId: null,
      }),
    ).toBe("notSynced");
  });

  it("keeps explicitly disabled relays offline", () => {
    expect(
      deriveEvoluServerState({
        evoluHasError: false,
        isOffline: true,
        state: "connected",
        syncOwnerId: null,
      }),
    ).toBe("offline");
  });
});
