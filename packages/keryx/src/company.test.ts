import { Effect } from "effect";
import { pairCompany, refreshCompany } from "./index";
import type {
  Announcement,
  CompanySnapshot,
  CompanySubscription,
  RefreshResult,
} from "./index";
import {
  FEED_URL,
  NOW,
  ORIGIN,
  PAST,
  REPO_BASE,
  makeKey,
  makeStandardPublisher,
  signMetadata,
} from "./testing/testPublisher";
import type { TestPublisher } from "./testing/testPublisher";

const pair = (publisher: TestPublisher, privateFeeds = [FEED_URL]) =>
  Effect.runPromise(
    pairCompany({
      origin: ORIGIN,
      privateFeeds,
      fetch: publisher.fetch,
      now: NOW,
    }),
  );

const subscriptionOf = (snapshot: CompanySnapshot): CompanySubscription => ({
  origin: snapshot.origin,
  trust: snapshot.trust,
  identity: snapshot.identity,
  channels: ["news", "alerts"],
  privateFeeds: [{ url: FEED_URL, closed: false }],
});

const refresh = (
  publisher: TestPublisher,
  subscription: CompanySubscription,
  known?: ReadonlyArray<Announcement>,
  now = NOW,
) =>
  Effect.runPromise(
    refreshCompany({
      subscription,
      fetch: publisher.fetch,
      now,
      ...(known === undefined ? {} : { known }),
    }),
  );

const refreshError = (
  publisher: TestPublisher,
  subscription: CompanySubscription,
) =>
  Effect.runPromise(
    Effect.flip(
      refreshCompany({ subscription, fetch: publisher.fetch, now: NOW }),
    ),
  );

const expectRefreshed = (result: RefreshResult) => {
  if (result._tag !== "Refreshed") throw new Error(`got ${result._tag}`);
  return result;
};

const ids = (result: RefreshResult) =>
  expectRefreshed(result)
    .announcements.map((announcement) => announcement.id)
    .sort();

const setup = async () => {
  const publisher = makeStandardPublisher();
  const subscription = subscriptionOf(await pair(publisher));
  return { publisher, subscription };
};

describe("pairCompany", () => {
  it("returns no logo for a linked logo without logo_sha256", async () => {
    const publisher = makeStandardPublisher();
    delete publisher.state.custom["logo_sha256"];
    publisher.publish();
    expect((await pair(publisher)).identity).toEqual({
      companyName: "ACME s.r.o.",
    });
  });

  it("rejects a private feed URL outside every authorized pattern", async () => {
    const publisher = makeStandardPublisher();
    const foreign =
      "https://evil.example/channels/tracking/AAAAAAAAAAAAAAAAAAAAAA/feed.json";
    const tooDeep = "https://shop.acme.example/channels/tracking/a/b/feed.json";
    const snapshot = await pair(publisher, [FEED_URL, foreign, tooDeep]);
    expect(snapshot.privateFeeds).toEqual([
      expect.objectContaining({
        url: FEED_URL,
        info: expect.objectContaining({ channel: "tracking" }),
      }),
      { url: foreign, info: null },
      { url: tooDeep, info: null },
    ]);
  });

  it("fails on a lite-mode repository", async () => {
    const publisher = makeStandardPublisher();
    publisher.state.rootCustom["mode"] = "lite";
    publisher.publishRoot();
    const error = await Effect.runPromise(
      Effect.flip(
        pairCompany({ origin: ORIGIN, fetch: publisher.fetch, now: NOW }),
      ),
    );
    expect(error._tag).toBe("KeryxLiteModeUnsupported");
  });

  it("fails when the targets signature threshold is not met", async () => {
    const publisher = makeStandardPublisher();
    const targets = JSON.parse(
      new TextDecoder().decode(publisher.files.get(`${REPO_BASE}targets.json`)),
    );
    publisher.files.set(
      `${REPO_BASE}targets.json`,
      new TextEncoder().encode(
        JSON.stringify(signMetadata(targets.signed, [makeKey()])),
      ),
    );
    const error = await Effect.runPromise(
      Effect.flip(
        pairCompany({ origin: ORIGIN, fetch: publisher.fetch, now: NOW }),
      ),
    );
    expect(error).toEqual(
      expect.objectContaining({ _tag: "KeryxMetadataInvalid" }),
    );
  });

  it("refuses a cross-origin redirect of the anchor", async () => {
    const publisher = makeStandardPublisher();
    const error = await Effect.runPromise(
      Effect.flip(
        pairCompany({
          origin: ORIGIN,
          now: NOW,
          fetch: async (url, init) => {
            const response = await publisher.fetch(url, init);
            Object.defineProperty(response, "url", {
              value: url.replace(ORIGIN, "https://evil.example"),
            });
            return response;
          },
        }),
      ),
    );
    expect(error).toEqual(
      expect.objectContaining({
        _tag: "KeryxFetchFailed",
        reason: expect.stringContaining("redirected"),
      }),
    );
  });
});

describe("refreshCompany: items", () => {
  it("shows verified items and drops unpublished ones", async () => {
    const { publisher, subscription } = await setup();
    const first = await refresh(publisher, subscription);
    expect(ids(first)).toEqual(["launch", "phishing", "shipped", "update"]);
    delete publisher.channels["news"]?.items["launch"];
    publisher.publish();
    const second = await refresh(
      publisher,
      { ...subscription, trust: expectRefreshed(first).trust },
      expectRefreshed(first).announcements,
    );
    expect(ids(second)).toEqual(["phishing", "shipped", "update"]);
  });

  it("drops an item whose signature does not verify, keeping the rest", async () => {
    const { publisher, subscription } = await setup();
    const news = publisher.channels["news"];
    if (news === undefined) throw new Error("no news");
    news.items["launch"] = { ...news.items["launch"], title: "Tampered" };
    publisher.publish();
    const result = expectRefreshed(await refresh(publisher, subscription));
    expect(ids(result)).toEqual(["phishing", "shipped", "update"]);
    expect(result.channels[0]).toEqual({
      channel: "news",
      status: "synced",
      problems: [
        {
          path: "channels/news/launch.json",
          reason: "bad signature",
          keptCachedCopy: false,
        },
      ],
    });
  });

  it("drops an item, even a cached one, once its signer is no longer authorized", async () => {
    const { publisher, subscription } = await setup();
    const first = expectRefreshed(await refresh(publisher, subscription));
    const alerts = publisher.channels["alerts"];
    if (alerts === undefined) throw new Error("no alerts");
    alerts.authors = [makeKey()];
    publisher.publish();
    const result = expectRefreshed(
      await refresh(
        publisher,
        { ...subscription, trust: first.trust },
        first.announcements,
      ),
    );
    expect(ids(result)).toEqual(["launch", "shipped", "update"]);
  });

  it("requires the authors role threshold, ignoring signatures by unknown keys", async () => {
    const { publisher, subscription } = await setup();
    const alerts = publisher.channels["alerts"];
    if (alerts === undefined) throw new Error("no alerts");
    const second = makeKey();
    alerts.authors = [publisher.keys.author, second];
    alerts.authorsThreshold = 2;
    publisher.item("alerts", "phishing", {}, [
      publisher.keys.author,
      makeKey(),
    ]);
    publisher.item("alerts", "both", {}, [
      publisher.keys.author,
      second,
      alerts.key,
    ]);
    publisher.publish();
    const result = expectRefreshed(await refresh(publisher, subscription));
    expect(ids(result)).toEqual(["both", "launch", "shipped", "update"]);
    expect(result.channels[1]?.problems).toEqual([
      {
        path: "channels/alerts/phishing.json",
        reason: "signature threshold not met",
        keptCachedCopy: false,
      },
    ]);
  });

  it("drops an authored channel whose authors role leaves the channel namespace", async () => {
    const { publisher, subscription } = await setup();
    const alerts = publisher.channels["alerts"];
    if (alerts === undefined) throw new Error("no alerts");
    alerts.authorsPaths = ["channels/*/*"];
    publisher.publish();
    const result = expectRefreshed(await refresh(publisher, subscription));
    expect(ids(result)).toEqual(["launch", "shipped", "update"]);
    expect(result.channels[1]?.status).toBe("removed");
    expect(result.catalog.map((channel) => channel.name)).toEqual(["news"]);
  });

  it("does not show an item whose bytes differ from the pinned hash, unless a verified copy is cached", async () => {
    const { publisher, subscription } = await setup();
    const first = expectRefreshed(await refresh(publisher, subscription));
    publisher.item("news", "launch", { title: "Launch, updated" });
    publisher.publish();
    publisher.files.set(
      `${REPO_BASE}channels/news/launch.json`,
      new TextEncoder().encode("{}"),
    );
    const fresh = expectRefreshed(await refresh(publisher, subscription));
    expect(ids(fresh)).toEqual(["phishing", "shipped", "update"]);
    expect(fresh.channels[0]?.problems).toEqual([
      expect.objectContaining({
        path: "channels/news/launch.json",
        keptCachedCopy: false,
      }),
    ]);
    const cached = expectRefreshed(
      await refresh(
        publisher,
        { ...subscription, trust: first.trust },
        first.announcements,
      ),
    );
    expect(cached.announcements.find((a) => a.id === "launch")?.title).toBe(
      "news launch",
    );
    expect(cached.channels[0]?.problems).toEqual([
      expect.objectContaining({
        path: "channels/news/launch.json",
        keptCachedCopy: true,
      }),
    ]);
  });

  it("rejects an item with a linked image but no image_sha256", async () => {
    const { publisher, subscription } = await setup();
    publisher.item("news", "launch", { image: "https://acme.example/a.png" });
    publisher.publish();
    const result = expectRefreshed(await refresh(publisher, subscription));
    expect(ids(result)).toEqual(["phishing", "shipped", "update"]);
  });

  it("reports a channel the company removed", async () => {
    const { publisher, subscription } = await setup();
    const result = expectRefreshed(
      await refresh(publisher, { ...subscription, channels: ["news", "gone"] }),
    );
    expect(result.channels[1]).toEqual({
      channel: "gone",
      status: "removed",
      problems: [],
    });
  });
});

describe("refreshCompany: metadata", () => {
  it("detects a rollback of the timestamp", async () => {
    const { publisher, subscription } = await setup();
    const old = new Map(publisher.files);
    publisher.publish();
    const first = expectRefreshed(await refresh(publisher, subscription));
    for (const [url, bytes] of old) publisher.files.set(url, bytes);
    const error = await refreshError(publisher, {
      ...subscription,
      trust: first.trust,
    });
    expect(error).toEqual(
      expect.objectContaining({
        _tag: "KeryxRollbackDetected",
        role: "timestamp",
        trustedVersion: 2,
        receivedVersion: 1,
      }),
    );
  });

  it("refreshes after the company drops a channel from the snapshot", async () => {
    const { publisher, subscription } = await setup();
    delete publisher.channels["news"];
    publisher.publish();
    const result = expectRefreshed(await refresh(publisher, subscription));
    expect(result.channels[0]?.status).toBe("removed");
    expect(result.trust.metaVersions["channels.news.json"]).toBe(1);
  });

  it("detects a rollback of a channel re-added below the version seen before it was dropped", async () => {
    const { publisher, subscription } = await setup();
    const news = publisher.channels["news"];
    if (news === undefined) throw new Error("no news");
    publisher.publish();
    const seen = expectRefreshed(await refresh(publisher, subscription));
    delete publisher.channels["news"];
    publisher.publish();
    const dropped = expectRefreshed(
      await refresh(publisher, { ...subscription, trust: seen.trust }),
    );
    publisher.channels["news"] = news;
    publisher.state.versions.delete("channels.news.json");
    publisher.publish();
    const error = await refreshError(publisher, {
      ...subscription,
      trust: dropped.trust,
    });
    expect(error).toEqual(
      expect.objectContaining({
        _tag: "KeryxRollbackDetected",
        role: "channels.news.json",
        trustedVersion: 2,
        receivedVersion: 1,
      }),
    );
  });

  it("reports expired metadata as a typed error", async () => {
    const { publisher, subscription } = await setup();
    publisher.state.timestampExpires = PAST;
    publisher.publish();
    const error = await refreshError(publisher, subscription);
    expect(error).toEqual(
      expect.objectContaining({
        _tag: "KeryxMetadataExpired",
        role: "timestamp",
      }),
    );
  });

  it("follows a root rotation published at the anchor", async () => {
    const { publisher, subscription } = await setup();
    const newMaster = makeKey();
    publisher.publishRoot({ rootKey: newMaster });
    publisher.publish();
    const result = expectRefreshed(await refresh(publisher, subscription));
    expect(JSON.parse(result.trust.rootJson).signed.version).toBe(2);
  });

  it("never fetches root metadata from the repo base", async () => {
    const { publisher, subscription } = await setup();
    publisher.publishRoot({ rootKey: makeKey(), at: REPO_BASE });
    const result = expectRefreshed(await refresh(publisher, subscription));
    expect(JSON.parse(result.trust.rootJson).signed.version).toBe(1);
    expect(
      publisher.requests.filter(
        (url) => url.startsWith(REPO_BASE) && url.includes("root"),
      ),
    ).toEqual([]);
  });

  it("suspends the company on a validly signed root that does not chain", async () => {
    const { publisher, subscription } = await setup();
    const attacker = makeKey();
    publisher.publishRoot({ rootKey: attacker, signers: [attacker] });
    expect(await refresh(publisher, subscription)).toEqual({
      _tag: "Suspended",
      rootVersion: 2,
      reason: expect.any(String),
    });
  });

  it("suspends the company when root.json forks the pinned version", async () => {
    const { publisher, subscription } = await setup();
    const attacker = makeKey();
    publisher.state.rootVersion = 0;
    publisher.publishRoot({ rootKey: attacker, signers: [attacker] });
    expect((await refresh(publisher, subscription))._tag).toBe("Suspended");
  });

  it("suspends the company on a newer root.json without the chain to it", async () => {
    const { publisher, subscription } = await setup();
    const attacker = makeKey();
    publisher.publishRoot({ rootKey: attacker, signers: [attacker] });
    const chainLink = `${ORIGIN}/.well-known/keryx/2.root.json`;
    publisher.files.delete(chainLink);
    expect(await refresh(publisher, subscription)).toEqual({
      _tag: "Suspended",
      rootVersion: 2,
      reason: expect.any(String),
    });
    const failing: TestPublisher = {
      ...publisher,
      fetch: async (url, init) =>
        url === chainLink
          ? new Response("busy", { status: 503 })
          : publisher.fetch(url, init),
    };
    expect((await refresh(failing, subscription))._tag).toBe("Refreshed");
  });

  it("follows a chained root.json while the next N.root.json is still a cached 404", async () => {
    const { publisher, subscription } = await setup();
    publisher.publishRoot({ rootKey: makeKey() });
    publisher.files.delete(`${ORIGIN}/.well-known/keryx/2.root.json`);
    publisher.publish();
    const result = expectRefreshed(await refresh(publisher, subscription));
    expect(JSON.parse(result.trust.rootJson).signed.version).toBe(2);
  });

  it("waits for a missing link two rotations back instead of suspending", async () => {
    const { publisher, subscription } = await setup();
    publisher.publishRoot({ rootKey: makeKey() });
    publisher.publishRoot({ rootKey: makeKey() });
    publisher.publish();
    const chainLink = `${ORIGIN}/.well-known/keryx/2.root.json`;
    const served = publisher.files.get(chainLink);
    publisher.files.delete(chainLink);
    expect(await refreshError(publisher, subscription)).toMatchObject({
      _tag: "KeryxFetchFailed",
      status: 404,
    });
    publisher.files.set(chainLink, served ?? new Uint8Array());
    const result = expectRefreshed(await refresh(publisher, subscription));
    expect(JSON.parse(result.trust.rootJson).signed.version).toBe(3);
  });

  it("treats junk at the anchor as unavailability, never suspension", async () => {
    const { publisher, subscription } = await setup();
    publisher.files.set(
      `${ORIGIN}/.well-known/keryx/2.root.json`,
      new TextEncoder().encode("<html>oops</html>"),
    );
    publisher.files.set(
      `${ORIGIN}/.well-known/keryx/root.json`,
      new TextEncoder().encode("<html>oops</html>"),
    );
    expect((await refresh(publisher, subscription))._tag).toBe("Refreshed");
  });
});

describe("refreshCompany: identity", () => {
  it("asks for a one-tap acknowledgement when only the logo changes", async () => {
    const { publisher, subscription } = await setup();
    publisher.state.custom["logo"] = "data:image/png;base64,AAAA";
    publisher.publish();
    const result = expectRefreshed(await refresh(publisher, subscription));
    expect(result.identityChange).toBe("cosmetic");
    expect(result.identity).toEqual({
      companyName: "ACME s.r.o.",
      logo: "data:image/png;base64,AAAA",
    });
    expect(result.announcements.length).toBe(4);
  });

  it("withholds content and requires pairing again on a new company name", async () => {
    const { publisher, subscription } = await setup();
    publisher.state.custom["company_name"] = "ACME Holdings";
    publisher.publish();
    expect(await refresh(publisher, subscription)).toEqual({
      _tag: "Rebranded",
      previousIdentity: subscription.identity,
      identity: expect.objectContaining({ companyName: "ACME Holdings" }),
    });
  });
});

describe("refreshCompany: private feeds", () => {
  const feedSync = async (
    publisher: TestPublisher,
    subscription: CompanySubscription,
  ) => expectRefreshed(await refresh(publisher, subscription)).privateFeeds[0];

  it("keeps the cache and retries while the feed is past expires", async () => {
    const { publisher, subscription } = await setup();
    publisher.publishFeed({ expires: PAST });
    expect(await feedSync(publisher, subscription)).toEqual(
      expect.objectContaining({
        status: "stale",
        state: { url: FEED_URL, closed: false },
      }),
    );
  });

  it("closes the feed on expired: true, keeping its final items", async () => {
    const { publisher, subscription } = await setup();
    publisher.publishFeed({ expired: true });
    const result = expectRefreshed(await refresh(publisher, subscription));
    expect(result.privateFeeds[0]).toEqual(
      expect.objectContaining({
        status: "closed",
        state: { url: FEED_URL, version: 2, closed: true },
      }),
    );
    expect(result.announcements.map((a) => a.id)).toContain("shipped");
  });

  it("closes the feed on 404", async () => {
    const { publisher, subscription } = await setup();
    publisher.files.delete(FEED_URL);
    expect((await feedSync(publisher, subscription))?.status).toBe("closed");
  });

  it("rejects a document signed for another URL or by another key", async () => {
    const { publisher, subscription } = await setup();
    publisher.publishFeed({ url: FEED_URL.replace("AAAA", "BBBB") });
    expect((await feedSync(publisher, subscription))?.status).toBe(
      "unavailable",
    );
    publisher.publishFeed({}, [makeKey()]);
    expect((await feedSync(publisher, subscription))?.status).toBe(
      "unavailable",
    );
  });

  it("rejects a rolled-back feed version", async () => {
    const { publisher, subscription } = await setup();
    const result = await feedSync(publisher, {
      ...subscription,
      privateFeeds: [{ url: FEED_URL, version: 5, closed: false }],
    });
    expect(result?.status).toBe("unavailable");
  });

  it("stops syncing a feed whose pattern is gone, keeping cached items", async () => {
    const { publisher, subscription } = await setup();
    const known = expectRefreshed(
      await refresh(publisher, subscription),
    ).announcements;
    const foreign = "https://evil.example/channels/tracking/x/feed.json";
    const shipped = known.find((a) => a.id === "shipped");
    if (shipped === undefined) throw new Error("no shipped item");
    const cachedForeign: Announcement = { ...shipped, privateFeedUrl: foreign };
    const result = expectRefreshed(
      await refresh(
        publisher,
        { ...subscription, privateFeeds: [{ url: foreign, closed: false }] },
        [cachedForeign],
      ),
    );
    expect(result.privateFeeds[0]).toEqual(
      expect.objectContaining({
        status: "unauthorized",
        state: { url: foreign, closed: true },
      }),
    );
    expect(
      result.announcements.filter((a) => a.privateFeedUrl !== undefined),
    ).toEqual([cachedForeign]);
  });
});
