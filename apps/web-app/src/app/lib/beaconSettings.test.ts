import { beforeEach, describe, expect, it } from "vitest";
import {
  readBeaconEnabled,
  readBeaconIntroSeen,
  readBeaconTrade,
  writeBeaconEnabled,
  writeBeaconIntroSeen,
  writeBeaconTrade,
} from "./beaconSettings";

describe("beacon settings", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to off, no trade and intro not seen", () => {
    expect(readBeaconEnabled()).toBe(false);
    expect(readBeaconTrade()).toBe("none");
    expect(readBeaconIntroSeen()).toBe(false);
  });

  it("stores the switch as a present or absent flag", () => {
    writeBeaconEnabled(true);
    expect(localStorage.getItem("linky.beacon.enabled.v1")).toBe("true");
    expect(readBeaconEnabled()).toBe(true);

    writeBeaconEnabled(false);
    expect(localStorage.getItem("linky.beacon.enabled.v1")).toBeNull();
    expect(readBeaconEnabled()).toBe(false);
  });

  it("stores a trade and removes it for none", () => {
    writeBeaconTrade("sell");
    expect(localStorage.getItem("linky.beacon.trade.v1")).toBe("sell");
    expect(readBeaconTrade()).toBe("sell");

    writeBeaconTrade("none");
    expect(localStorage.getItem("linky.beacon.trade.v1")).toBeNull();
  });

  it("remembers the intro", () => {
    writeBeaconIntroSeen();
    expect(readBeaconIntroSeen()).toBe(true);
  });

  it("reads unknown stored values as the defaults", () => {
    localStorage.setItem("linky.beacon.enabled.v1", "yes");
    localStorage.setItem("linky.beacon.trade.v1", "none");
    expect(readBeaconEnabled()).toBe(false);
    expect(readBeaconTrade()).toBe("none");
  });
});
