import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatShortLightningAddress, formatTimeAgo } from "./formatting";

describe("formatShortLightningAddress", () => {
  it("shortens npub local parts while preserving the lightning domain", () => {
    expect(
      formatShortLightningAddress(
        "npub1sages7tvxdmmtu9gadt80dk2jzws767l30r6xntq39ffhrp0ytlsax9yar@npub.cash",
      ),
    ).toBe("npub1sages…ax9yar@npub.cash");

    expect(
      formatShortLightningAddress(
        "npub1sages7tvxdmmtu9gadt80dk2jzws767l30r6xntq39ffhrp0ytlsax9yar@linky.fit",
      ),
    ).toBe("npub1sages…ax9yar@linky.fit");
  });
});

describe("formatTimeAgo", () => {
  const now = Date.UTC(2026, 9, 12, 12, 0, 0) / 1000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows recent times relative to now", () => {
    expect(formatTimeAgo(now - 10, "en")).toBe("now");
    expect(formatTimeAgo(now + 30, "en")).toBe("now");
    expect(formatTimeAgo(now - 5 * 60, "en")).toBe("5m ago");
    expect(formatTimeAgo(now - 2 * 3600, "en")).toBe("2h ago");
    expect(formatTimeAgo(now - 30 * 3600, "en")).toBe("yesterday");
    expect(formatTimeAgo(now - 6 * 86400, "en")).toBe("6d ago");
    expect(formatTimeAgo(now - 2 * 3600, "cs")).toBe("před 2 h");
  });

  it("shows a date from a week back", () => {
    expect(formatTimeAgo(now - 7 * 86400, "en")).toBe("Oct 5, 2026");
  });

  it("shows nothing for a missing timestamp", () => {
    expect(formatTimeAgo(0, "en")).toBe("");
    expect(formatTimeAgo(Number.NaN, "en")).toBe("");
  });
});
