import { describe, expect, it } from "vitest";
import {
  publishedSupporterBadge,
  shownSupporterBadge,
  unlockedSupporterTier,
  type SupporterAwardStamp,
} from "./supporterPerks";

const DAY = 24 * 60 * 60;
const now = Date.UTC(2026, 9, 3) / 1000;
const lapsed = now - 40 * DAY;
const recent = now - 10 * DAY;
const newest = now - DAY;

describe("shownSupporterBadge", () => {
  it("shows the highest valid tier, whatever the order", () => {
    const awards: SupporterAwardStamp[] = [
      { badge: "bronze", awardedAt: newest },
      { badge: "generic", awardedAt: newest },
      { badge: "gold", awardedAt: recent },
      { badge: "diamond", awardedAt: lapsed },
    ];

    expect(shownSupporterBadge(awards, now)).toBe("gold");
  });

  it("ranks the generic badge below every tier", () => {
    expect(
      shownSupporterBadge(
        [
          { badge: "generic", awardedAt: newest },
          { badge: "bronze", awardedAt: recent },
        ],
        now,
      ),
    ).toBe("bronze");
    expect(
      shownSupporterBadge([{ badge: "generic", awardedAt: recent }], now),
    ).toBe("generic");
  });

  it("shows nothing once every award lapsed", () => {
    expect(
      shownSupporterBadge([{ badge: "gold", awardedAt: lapsed }], now),
    ).toBeNull();
    expect(shownSupporterBadge([], now)).toBeNull();
  });

  it("applies the validity override", () => {
    const awards: SupporterAwardStamp[] = [
      { badge: "silver", awardedAt: now - 120 },
    ];

    expect(shownSupporterBadge(awards, now, 300)).toBe("silver");
    expect(shownSupporterBadge(awards, now, 60)).toBeNull();
  });
});

describe("unlockedSupporterTier", () => {
  it("takes the highest valid tier and ignores generic awards", () => {
    expect(
      unlockedSupporterTier(
        [
          { badge: "generic", awardedAt: newest },
          { badge: "silver", awardedAt: recent },
          { badge: "diamond", awardedAt: lapsed },
        ],
        now,
      ),
    ).toBe("silver");
    expect(
      unlockedSupporterTier([{ badge: "generic", awardedAt: newest }], now),
    ).toBeNull();
  });
});

describe("publishedSupporterBadge", () => {
  const awards: SupporterAwardStamp[] = [
    { badge: "gold", awardedAt: recent },
    { badge: "generic", awardedAt: recent },
    { badge: "bronze", awardedAt: newest },
    { badge: "generic", awardedAt: newest },
  ];

  it("publishes the newest valid award of the chosen kind", () => {
    expect(publishedSupporterBadge(awards, "tier", now)).toBe("bronze");
    expect(publishedSupporterBadge(awards, "generic", now)).toBe("generic");
  });

  it("publishes nothing when hidden or lapsed", () => {
    expect(publishedSupporterBadge(awards, "hide", now)).toBeNull();
    expect(
      publishedSupporterBadge(
        [{ badge: "gold", awardedAt: lapsed }],
        "tier",
        now,
      ),
    ).toBeNull();
  });
});
