import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dismissPaidBanner,
  PAID_BANNER_MS,
  readPaidBanner,
  showPaidBanner,
} from "./paidBanner";

const banner = {
  key: "p1",
  title: "Paid",
  amount: "120",
  unit: "CZK",
  payerPubkey: null,
};

afterEach(() => {
  dismissPaidBanner();
  vi.useRealTimers();
});

describe("paid banner", () => {
  it("stays for its time and closes itself", () => {
    vi.useFakeTimers();
    showPaidBanner(banner);
    expect(readPaidBanner()).toEqual(banner);
    vi.advanceTimersByTime(PAID_BANNER_MS - 1);
    expect(readPaidBanner()).toEqual(banner);
    vi.advanceTimersByTime(1);
    expect(readPaidBanner()).toBeNull();
  });

  it("closes on dismiss and lets a newer payment replace an older one", () => {
    vi.useFakeTimers();
    showPaidBanner(banner);
    showPaidBanner({ ...banner, key: "p2" });
    expect(readPaidBanner()?.key).toBe("p2");
    dismissPaidBanner();
    expect(readPaidBanner()).toBeNull();
  });
});
