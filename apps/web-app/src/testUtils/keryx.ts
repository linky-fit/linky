import type {
  Announcement,
  CompanySnapshot,
  Refreshed,
} from "@linky-fit/keryx";

export const ORIGIN = "https://acme.example";
export const FEED_URL =
  "https://acme.example/channels/tracking/SECRETTOKEN0123456789/feed.json";

export const trust = (snapshotVersion = 1) => ({
  rootJson: '{"signed":{"version":1}}',
  timestampVersion: 1,
  snapshotVersion,
  metaVersions: { "targets.json": 1 },
});

export const snapshot = (
  overrides: Partial<CompanySnapshot> = {},
): CompanySnapshot => ({
  origin: ORIGIN,
  trust: trust(),
  identity: { companyName: "Acme" },
  catalog: [
    { name: "news", displayName: "News" },
    { name: "security", displayName: "Security alerts" },
  ],
  privateFeeds: [
    {
      url: FEED_URL,
      info: { channel: "tracking", displayName: "Package tracking" },
    },
    { url: `${ORIGIN}/unauthorized/feed.json`, info: null },
  ],
  ...overrides,
});

export const announcement = (
  overrides: Partial<Announcement> = {},
): Announcement => ({
  channel: "news",
  id: "launch",
  title: "Launch",
  contentHtml: "<p>Hello</p>",
  datePublished: "2030-01-01T00:00:00Z",
  tags: [],
  attachments: [],
  ...overrides,
});

export const refreshed = (overrides: Partial<Refreshed> = {}): Refreshed => ({
  _tag: "Refreshed",
  trust: trust(),
  identity: { companyName: "Acme" },
  identityChange: "none",
  catalog: snapshot().catalog,
  channels: [{ channel: "news", status: "synced", problems: [] }],
  privateFeeds: [
    {
      state: { url: FEED_URL, closed: false },
      status: "active",
      info: { channel: "tracking", displayName: "Package tracking" },
      problems: [],
    },
  ],
  announcements: [announcement()],
  ...overrides,
});
