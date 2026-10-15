import { describe, expect, it } from "vitest";
import {
  announcement,
  FEED_URL,
  ORIGIN,
  refreshed,
  snapshot,
  trust,
} from "../../testUtils/keryx";
import {
  announcementKey,
  announcementSourceName,
  nextCacheEntry,
  pairedCacheEntry,
  privateFeedKey,
  visibleAnnouncements,
  withFeedStates,
} from "./keryxCache";

const NOW = new Date("2030-01-02T00:00:00Z");
const subscription = {
  origin: ORIGIN,
  trust: trust(),
  identity: { companyName: "Acme" },
  channels: ["news"],
  privateFeeds: [{ url: FEED_URL, closed: false }],
};
const tracking = announcement({
  channel: "tracking",
  id: "shipped",
  privateFeedUrl: FEED_URL,
});
const security = announcement({ channel: "security", id: "advisory" });

describe("keryx cache", () => {
  it("names channels and private feeds from the pairing", () => {
    const entry = pairedCacheEntry(snapshot());
    expect(announcementSourceName(entry, announcement())).toBe("News");
    expect(announcementSourceName(entry, tracking)).toBe("Package tracking");
    expect(announcementSourceName(entry, security)).toBe("Security alerts");
  });

  it("replaces the announcements with the refreshed list", () => {
    const entry = nextCacheEntry(
      { ...pairedCacheEntry(snapshot()), announcements: [security] },
      refreshed({ announcements: [tracking] }),
      NOW,
    );
    expect(entry).toMatchObject({
      status: "active",
      announcements: [tracking],
      refreshedAt: NOW.toISOString(),
    });
    expect(entry.pendingIdentity).toBeUndefined();
  });

  it("keeps private feed states on the device and resumes from them", () => {
    const closed = { url: FEED_URL, version: 3, closed: true };
    const entry = nextCacheEntry(
      pairedCacheEntry(snapshot()),
      refreshed({
        privateFeeds: [{ state: closed, status: "closed", problems: [] }],
      }),
      NOW,
    );
    const added = { url: `${FEED_URL}?2`, closed: false };
    expect(
      withFeedStates(
        {
          ...subscription,
          privateFeeds: [...subscription.privateFeeds, added],
        },
        entry,
      ).privateFeeds,
    ).toEqual([closed, added]);
  });

  it("keeps a new logo pending until acknowledged", () => {
    const identity = { companyName: "Acme", logo: "data:image/png;base64,AA" };
    const entry = nextCacheEntry(
      pairedCacheEntry(snapshot()),
      refreshed({ identity, identityChange: "cosmetic" }),
      NOW,
    );
    expect(entry.pendingIdentity).toEqual(identity);
  });

  it("hides everything of a suspended or rebranded company", () => {
    const cached = {
      ...pairedCacheEntry(snapshot()),
      announcements: [announcement()],
    };
    const suspended = nextCacheEntry(
      cached,
      { _tag: "Suspended", rootVersion: 3, reason: "no chain" },
      NOW,
    );
    expect(suspended).toMatchObject({ status: "suspended", announcements: [] });
    expect(visibleAnnouncements(cached, subscription)).toHaveLength(1);
    expect(visibleAnnouncements(suspended, subscription)).toEqual([]);

    const rebranded = nextCacheEntry(
      cached,
      {
        _tag: "Rebranded",
        previousIdentity: { companyName: "Acme" },
        identity: { companyName: "Evil" },
      },
      NOW,
    );
    expect(rebranded).toMatchObject({
      status: "rebranded",
      announcements: [],
      pendingIdentity: { companyName: "Evil" },
    });
  });

  it("shows only followed channels and every private feed", () => {
    const entry = {
      ...pairedCacheEntry(snapshot()),
      announcements: [announcement(), security, tracking],
    };
    expect(visibleAnnouncements(entry, subscription)).toEqual([
      announcement(),
      tracking,
    ]);
  });

  it("keys private feed items without the capability URL", () => {
    const key = announcementKey(tracking);
    expect(key).toBe(`${privateFeedKey(FEED_URL)}/shipped`);
    expect(key).not.toContain("SECRETTOKEN");
    expect(announcementKey(announcement())).toBe("news/launch");
  });
});
