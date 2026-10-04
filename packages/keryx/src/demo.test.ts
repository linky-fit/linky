import { Effect, Either, Schema } from "effect";
import {
  CompanyIdentity,
  CompanyTrust,
  fetchVerifiedMedia,
  pairCompany,
  parseJoinUrl,
  refreshCompany,
} from "./index";
import type { CompanySnapshot, CompanySubscription, Refreshed } from "./index";
import {
  DEMO_NOW,
  demoCapture,
  makeFixtureFetch,
  readDemoFile,
} from "./testing/fixtureFetch";

const ORIGIN = "https://keryx-demo.github.io";
const FEED =
  "https://keryx-demo.github.io/channels/tracking/m1-4zSDEm_Av71cnV26ZqQ/feed.json";

const join = () => Either.getOrThrow(parseJoinUrl(demoCapture.joinUrl));

const pair = async () => {
  const { fetch } = makeFixtureFetch();
  const request = join();
  return Effect.runPromise(
    pairCompany({
      origin: request.origin,
      privateFeeds: request.privateFeeds,
      fetch,
      now: DEMO_NOW,
    }),
  );
};

const subscriptionOf = (
  snapshot: CompanySnapshot,
  trust = snapshot.trust,
): CompanySubscription => ({
  origin: snapshot.origin,
  trust,
  identity: snapshot.identity,
  channels: snapshot.catalog.map((channel) => channel.name),
  privateFeeds: [{ url: FEED, closed: false }],
});

const refreshed = async (
  subscription: CompanySubscription,
  options: { known?: Refreshed["announcements"]; now?: Date } = {},
) => {
  const { fetch, requests } = makeFixtureFetch();
  const result = await Effect.runPromise(
    refreshCompany({
      subscription,
      fetch,
      now: options.now ?? DEMO_NOW,
      ...(options.known === undefined ? {} : { known: options.known }),
    }),
  );
  if (result._tag !== "Refreshed") throw new Error(result._tag);
  return { result, requests };
};

describe("the keryx-demo.github.io publisher", () => {
  it("parses the demo join URL", () => {
    expect(join()).toEqual({
      origin: ORIGIN,
      channels: ["security", "news", "insights"],
      privateFeeds: [FEED],
    });
  });

  it("pairs: verified identity, channel catalog and authorized private feed", async () => {
    const snapshot = await pair();
    expect(snapshot.identity).toEqual({
      companyName: "Trezor Company s.r.o.",
      logo: "https://keryx-demo.github.io/media/logo.png",
      logoSha256:
        "f6d041ffc76796ec507eedcf8e4153049249a0684f1160ecdfd3667c7be88c7d",
    });
    expect(snapshot.catalog).toEqual([
      {
        name: "security",
        displayName: "Security alerts",
        description:
          "Phishing warnings, security advisories and key announcements",
      },
      {
        name: "news",
        displayName: "Product news & updates",
        description: "New releases, features and company announcements",
      },
      {
        name: "insights",
        displayName: "Insights & guides",
        description: "Self-custody guides, explainers and opinion",
      },
    ]);
    expect(snapshot.privateFeeds).toEqual([
      {
        url: FEED,
        info: {
          channel: "tracking",
          displayName: "Package tracking",
          purpose: "per-order delivery notifications (capability feed)",
        },
      },
    ]);
    expect(JSON.parse(snapshot.trust.rootJson).signed.version).toBe(2);
  });

  it("round-trips the persisted trust and identity as JSON strings", async () => {
    const snapshot = await pair();
    const trustJson = Schema.parseJson(CompanyTrust);
    const identityJson = Schema.parseJson(CompanyIdentity);
    expect(
      Schema.decodeSync(trustJson)(
        Schema.encodeSync(trustJson)(snapshot.trust),
      ),
    ).toEqual(snapshot.trust);
    expect(
      Schema.decodeSync(identityJson)(
        Schema.encodeSync(identityJson)(snapshot.identity),
      ),
    ).toEqual(snapshot.identity);
  });

  it("refreshes every channel and the private feed, all items verified", async () => {
    const { result } = await refreshed(subscriptionOf(await pair()));
    expect(result.identityChange).toBe("none");
    expect(result.channels).toEqual([
      { channel: "security", status: "synced", problems: [] },
      { channel: "news", status: "synced", problems: [] },
      { channel: "insights", status: "synced", problems: [] },
    ]);
    expect(result.privateFeeds).toEqual([
      expect.objectContaining({
        state: { url: FEED, version: 1, closed: false },
        status: "active",
        problems: [],
      }),
    ]);
    const count = (channel: string) =>
      result.announcements.filter((a) => a.channel === channel).length;
    expect(count("security")).toBe(16);
    expect(count("news")).toBe(6);
    expect(count("insights")).toBe(2);
    expect(count("tracking")).toBe(1);
    const dates = result.announcements.map((a) => a.datePublished);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(
      result.announcements.find((a) => a.id === "order-2026-0841-shipped"),
    ).toEqual(
      expect.objectContaining({
        privateFeedUrl: FEED,
        imageSha256:
          "f6d041ffc76796ec507eedcf8e4153049249a0684f1160ecdfd3667c7be88c7d",
        attachments: [
          expect.objectContaining({
            name: "Order summary",
            mimeType: "text/plain",
            sizeInBytes: 179,
          }),
        ],
      }),
    );
  });

  it("walks the root chain from a pinned version 1, only through the well-known anchor", async () => {
    const snapshot = await pair();
    const pinnedV1 = {
      ...snapshot.trust,
      rootJson: readDemoFile(`${ORIGIN}/.well-known/keryx/1.root.json`),
    };
    const { result, requests } = await refreshed(
      subscriptionOf(snapshot, pinnedV1),
    );
    expect(JSON.parse(result.trust.rootJson).signed.version).toBe(2);
    expect(requests).toContain(`${ORIGIN}/.well-known/keryx/2.root.json`);
    expect(requests).toContain(`${ORIGIN}/.well-known/keryx/3.root.json`);
    expect(requests.filter((url) => url.includes("root.json"))).toEqual(
      requests.filter((url) => url.startsWith(`${ORIGIN}/.well-known/keryx/`)),
    );
  });

  it("re-verifies known announcements without downloading them again", async () => {
    const subscription = subscriptionOf(await pair());
    const first = await refreshed(subscription);
    const second = await refreshed(
      { ...subscription, trust: first.result.trust },
      { known: first.result.announcements },
    );
    expect(second.result.announcements).toEqual(first.result.announcements);
    expect(
      second.requests.filter((url) => url.includes("/keryx/channels/")),
    ).toEqual([]);
  });

  it("degrades to an expiry error once the timestamp expires", async () => {
    const { fetch } = makeFixtureFetch();
    const timestamp = JSON.parse(readDemoFile(`${ORIGIN}/keryx/timestamp.json`))
      .signed.expires;
    const error = await Effect.runPromise(
      Effect.flip(
        refreshCompany({
          subscription: subscriptionOf(await pair()),
          fetch,
          now: new Date(Date.parse(timestamp) + 1000),
        }),
      ),
    );
    expect(error).toEqual(
      expect.objectContaining({
        _tag: "KeryxMetadataExpired",
        role: "timestamp",
      }),
    );
  });

  it("serves a linked logo only when its bytes match logo_sha256", async () => {
    const { fetch } = makeFixtureFetch();
    const { identity } = await pair();
    const logo = await Effect.runPromise(
      fetchVerifiedMedia({
        url: identity.logo ?? "",
        sha256: identity.logoSha256 ?? "",
        fetch,
      }),
    );
    expect(logo.length).toBe(1302);
    const mismatch = await Effect.runPromise(
      Effect.flip(
        fetchVerifiedMedia({
          url: identity.logo ?? "",
          sha256: "0".repeat(64),
          fetch,
        }),
      ),
    );
    expect(mismatch._tag).toBe("KeryxMediaUnavailable");
  });
});
