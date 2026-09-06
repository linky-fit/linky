import { Effect, Exit, Layer, Option } from "effect";
import { finalizeEvent, verifyEvent } from "nostr-tools";
import type { Event as NostrToolsEvent, Filter } from "nostr-tools";
import { Pubkey, RelayUrl, UnixSeconds } from "../domain/primitives";
import { AUTHOR_FILTER_LIMIT } from "../internal/authorChunks";
import { firstTagValue } from "../internal/nostrEvent";
import type { SignedPlainEvent } from "../internal/nostrEvent";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import type { LinkstrIdentityService } from "../services/LinkstrIdentity";
import { RelayUnreachable } from "../services/NostrTransport";
import type { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import { makeIdentity, stubPlainTransport } from "../testing";
import { decodeProfileMetadata } from "./codec";
import { ProfileMetadata, StatusDraft } from "./domain";
import { Profiles } from "./Profiles";

const alice = makeIdentity();
const bob = makeIdentity();
const carol = makeIdentity();

const relayA = RelayUrl.make("wss://relay-a.test");
const relayB = RelayUrl.make("wss://relay-b.test");

const base = 1_754_000_000;

const profileEvent = (
  identity: LinkstrIdentityService,
  content: string,
  createdAt: number,
): NostrToolsEvent =>
  finalizeEvent(
    { kind: 0, tags: [], content, created_at: createdAt },
    identity.secretKey,
  );

const noteEvent = (
  identity: LinkstrIdentityService,
  createdAt: number,
): NostrToolsEvent =>
  finalizeEvent(
    { kind: 1, tags: [], content: "note", created_at: createdAt },
    identity.secretKey,
  );

const statusEvent = (
  identity: LinkstrIdentityService,
  content: string,
  createdAt: number,
  tags: Array<Array<string>> = [["d", "general"]],
): NostrToolsEvent =>
  finalizeEvent(
    { kind: 30315, tags, content, created_at: createdAt },
    identity.secretKey,
  );

const stubTransport = (
  published: Array<SignedPlainEvent>,
  options?: {
    accept?: (event: SignedPlainEvent, relay: RelayUrl) => boolean;
    fetchLog?: Array<Filter>;
    stored?: ReadonlyMap<RelayUrl, ReadonlyArray<NostrToolsEvent>>;
    unreachable?: ReadonlyArray<RelayUrl>;
    silent?: ReadonlyArray<RelayUrl>;
  },
): Layer.Layer<NostrTransport> =>
  stubPlainTransport(published, options?.accept ?? (() => true), {
    fetch: (relay, filter) =>
      Effect.suspend(() => {
        options?.fetchLog?.push(filter);
        if (options?.silent?.includes(relay) === true) return Effect.never;
        return options?.unreachable?.includes(relay) === true
          ? new RelayUnreachable({ relay, detail: "down" })
          : Effect.succeed(options?.stored?.get(relay) ?? []);
      }),
  });

const runWith = <A, E>(
  transport: Layer.Layer<NostrTransport>,
  program: Effect.Effect<A, E, Profiles>,
  relays: ReadonlyArray<RelayUrl> = [relayA, relayB],
): Promise<Exit.Exit<A, E>> =>
  Effect.runPromiseExit(
    program.pipe(
      Effect.provide(
        Profiles.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              LinkstrIdentity.fromSecretKey(alice.secretKey),
              RelayPolicy.fixed({ readRelays: relays, writeRelays: relays }),
              transport,
            ),
          ),
        ),
      ),
    ),
  );

describe("decodeProfileMetadata", () => {
  it("falls back to the legacy image field when picture is missing", () => {
    const metadata = decodeProfileMetadata(
      JSON.stringify({ image: "https://pic.test/a.png" }),
    );
    assert(Option.isSome(metadata));
    expect(metadata.value.picture).toBe("https://pic.test/a.png");

    const both = decodeProfileMetadata(
      JSON.stringify({ picture: "https://pic.test/p.png", image: "x" }),
    );
    assert(Option.isSome(both));
    expect(both.value.picture).toBe("https://pic.test/p.png");
  });
});

describe("Profiles.publishProfile", () => {
  it("publishes a signed kind 0 with wire field names, omitting empties", async () => {
    const published: Array<SignedPlainEvent> = [];
    const exit = await runWith(
      stubTransport(published),
      Effect.flatMap(Profiles, (profiles) =>
        profiles.publishProfile(
          new ProfileMetadata({
            name: "alice",
            displayName: "Alice",
            lud16: "alice@pay.test",
            about: "",
          }),
        ),
      ),
    );

    assert(Exit.isSuccess(exit));
    expect(published).toHaveLength(1);
    const event = published[0];
    if (event === undefined) return;
    expect(event.kind).toBe(0);
    expect(event.pubkey).toBe(alice.pubkey);
    expect(verifyEvent(event)).toBe(true);
    expect(JSON.parse(event.content)).toEqual({
      name: "alice",
      display_name: "Alice",
      lud16: "alice@pay.test",
    });
    expect(exit.value.eventId).toBe(event.id);
    expect(exit.value.kind).toBe(0);
    expect(exit.value.results).toEqual([
      expect.objectContaining({ relay: relayA, accepted: true }),
      expect.objectContaining({ relay: relayB, accepted: true }),
    ]);
  });

  it("fails with NoRelayAcceptedEvent when every relay rejects", async () => {
    const exit = await runWith(
      stubTransport([], { accept: () => false }),
      Effect.flatMap(Profiles, (profiles) =>
        profiles.publishProfile(new ProfileMetadata({ name: "alice" })),
      ),
    );

    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: "NoRelayAcceptedEvent",
          kind: 0,
          results: [
            expect.objectContaining({ accepted: false, detail: "blocked" }),
            expect.objectContaining({ accepted: false, detail: "blocked" }),
          ],
        }),
      ),
    );
  });
});

describe("Profiles.publishStatus", () => {
  it("publishes kind 30315 with d=general and the expiration tag", async () => {
    const published: Array<SignedPlainEvent> = [];
    const expiresAt = UnixSeconds.make(base + 3600);
    const exit = await runWith(
      stubTransport(published),
      Effect.flatMap(Profiles, (profiles) =>
        profiles.publishStatus(
          new StatusDraft({ content: "21000 sats", expiresAt }),
        ),
      ),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    const event = published[0];
    if (event === undefined) return;
    expect(event.kind).toBe(30315);
    expect(event.content).toBe("21000 sats");
    expect(firstTagValue(event.tags, "d")).toBe("general");
    expect(firstTagValue(event.tags, "expiration")).toBe(String(expiresAt));
  });

  it("omits the expiration tag when no expiry is set", async () => {
    const published: Array<SignedPlainEvent> = [];
    await runWith(
      stubTransport(published),
      Effect.flatMap(Profiles, (profiles) =>
        profiles.publishStatus(new StatusDraft({ content: "" })),
      ),
    );
    const event = published[0];
    if (event === undefined) throw new Error("nothing published");
    expect(event.tags).toEqual([["d", "general"]]);
  });
});

describe("Profiles.fetchProfile", () => {
  it("returns the newest valid profile and status across relays", async () => {
    const inOneHour = Math.floor(Date.now() / 1000) + 3600;
    const stored = new Map<RelayUrl, ReadonlyArray<NostrToolsEvent>>([
      [
        relayA,
        [
          profileEvent(bob, JSON.stringify({ name: "bob-old" }), base + 1),
          statusEvent(bob, "listening", base + 2, [
            ["d", "general"],
            ["expiration", String(inOneHour)],
          ]),
        ],
      ],
      [
        relayB,
        [
          // Newest kind 0 is malformed: the older valid one must win instead.
          profileEvent(bob, "not json", base + 9),
          profileEvent(bob, JSON.stringify({ name: "bob-old" }), base + 1),
        ],
      ],
    ]);

    const exit = await runWith(
      stubTransport([], { stored }),
      Effect.flatMap(Profiles, (profiles) => profiles.fetchProfile(bob.pubkey)),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.profile).toEqual(
      expect.objectContaining({
        _tag: "ProfileUpdated",
        pubkey: bob.pubkey,
        updatedAt: base + 1,
        metadata: expect.objectContaining({ name: "bob-old" }),
      }),
    );
    expect(exit.value.status).toEqual(
      expect.objectContaining({
        _tag: "StatusUpdated",
        content: "listening",
        expiresAt: inOneHour,
      }),
    );
  });

  it("returns nulls when nothing valid is stored and one relay is down", async () => {
    const stored = new Map<RelayUrl, ReadonlyArray<NostrToolsEvent>>([
      [
        relayB,
        [
          statusEvent(bob, "gone", base + 1, [
            ["d", "general"],
            ["expiration", String(base + 2)],
          ]),
        ],
      ],
    ]);
    const exit = await runWith(
      stubTransport([], { stored, unreachable: [relayA] }),
      Effect.flatMap(Profiles, (profiles) => profiles.fetchProfile(bob.pubkey)),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.profile).toBeNull();
    expect(exit.value.status).toBeNull();
  });
});

describe("Profiles.fetchProfiles", () => {
  it("returns one entry per pubkey in input order, each resolved newest-wins", async () => {
    const inOneHour = Math.floor(Date.now() / 1000) + 3600;
    const stored = new Map<RelayUrl, ReadonlyArray<NostrToolsEvent>>([
      [
        relayA,
        [
          profileEvent(bob, JSON.stringify({ name: "bob-old" }), base + 1),
          statusEvent(bob, "listening", base + 2, [
            ["d", "general"],
            ["expiration", String(inOneHour)],
          ]),
        ],
      ],
      [
        relayB,
        [
          // Newest kind 0 for bob is malformed: the older valid one must win.
          profileEvent(bob, "not json", base + 9),
          profileEvent(carol, JSON.stringify({ name: "carol" }), base + 3),
        ],
      ],
    ]);

    const exit = await runWith(
      stubTransport([], { stored }),
      Effect.flatMap(Profiles, (profiles) =>
        profiles.fetchProfiles([bob.pubkey, carol.pubkey, alice.pubkey]),
      ),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value).toEqual([
      expect.objectContaining({
        pubkey: bob.pubkey,
        profile: expect.objectContaining({
          updatedAt: base + 1,
          metadata: expect.objectContaining({ name: "bob-old" }),
        }),
        status: expect.objectContaining({ content: "listening" }),
      }),
      expect.objectContaining({
        pubkey: carol.pubkey,
        profile: expect.objectContaining({
          metadata: expect.objectContaining({ name: "carol" }),
        }),
        status: null,
      }),
      expect.objectContaining({
        pubkey: alice.pubkey,
        profile: null,
        status: null,
      }),
    ]);
  });

  it("dedupes input and issues one multi-author filter per relay", async () => {
    const fetchLog: Array<Filter> = [];
    const exit = await runWith(
      stubTransport([], { fetchLog }),
      Effect.flatMap(Profiles, (profiles) =>
        profiles.fetchProfiles([bob.pubkey, carol.pubkey, bob.pubkey]),
      ),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value).toHaveLength(2);
    expect(fetchLog).toEqual([
      { kinds: [0, 30315], authors: [bob.pubkey, carol.pubkey] },
      { kinds: [0, 30315], authors: [bob.pubkey, carol.pubkey] },
    ]);
  });

  it("splits authors into filter chunks at the author cap", async () => {
    const pubkeys = Array.from(
      { length: AUTHOR_FILTER_LIMIT + 1 },
      () => makeIdentity().pubkey,
    );
    const fetchLog: Array<Filter> = [];

    const exit = await runWith(
      stubTransport([], { fetchLog }),
      Effect.flatMap(Profiles, (profiles) => profiles.fetchProfiles(pubkeys)),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value).toHaveLength(pubkeys.length);

    // Two chunks, each queried on both relays.
    const authorCounts = fetchLog
      .map((filter) => filter.authors?.length ?? 0)
      .sort((a, b) => a - b);
    expect(authorCounts).toEqual([
      1,
      1,
      AUTHOR_FILTER_LIMIT,
      AUTHOR_FILTER_LIMIT,
    ]);
    const queried = new Set(fetchLog.flatMap((filter) => filter.authors ?? []));
    expect(queried.size).toBe(pubkeys.length);
  });

  it("returns an empty list without touching the transport", async () => {
    const fetchLog: Array<Filter> = [];
    const exit = await runWith(
      stubTransport([], { fetchLog }),
      Effect.flatMap(Profiles, (profiles) => profiles.fetchProfiles([])),
    );
    expect(exit).toEqual(Exit.succeed([]));
    expect(fetchLog).toHaveLength(0);
  });
});

describe("Profiles.discoverActiveProfiles", () => {
  it("returns authors newest-activity-first with their newest decodable profile", async () => {
    const stored = new Map<RelayUrl, ReadonlyArray<NostrToolsEvent>>([
      [
        relayA,
        [
          noteEvent(bob, base + 10),
          profileEvent(bob, JSON.stringify({ name: "bob" }), base + 1),
        ],
      ],
      [
        relayB,
        [
          noteEvent(carol, base + 5),
          profileEvent(carol, JSON.stringify({ name: "carol" }), base + 2),
          // Newest kind 0 for bob is malformed: the older valid one must win.
          profileEvent(bob, "not json", base + 3),
        ],
      ],
    ]);
    const fetchLog: Array<Filter> = [];

    const exit = await runWith(
      stubTransport([], { stored, fetchLog }),
      Effect.flatMap(Profiles, (profiles) => profiles.discoverActiveProfiles()),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value).toEqual([
      expect.objectContaining({
        pubkey: bob.pubkey,
        lastActiveAt: base + 10,
        metadata: expect.objectContaining({ name: "bob" }),
      }),
      expect.objectContaining({
        pubkey: carol.pubkey,
        lastActiveAt: base + 5,
        metadata: expect.objectContaining({ name: "carol" }),
      }),
    ]);

    const profileFilters = fetchLog.filter((filter) => filter.authors);
    expect(profileFilters).toEqual([
      { authors: [bob.pubkey, carol.pubkey], kinds: [0], limit: 4 },
      { authors: [bob.pubkey, carol.pubkey], kinds: [0], limit: 4 },
    ]);
  });

  it("omits authors without a decodable kind-0 profile", async () => {
    const stored = new Map<RelayUrl, ReadonlyArray<NostrToolsEvent>>([
      [
        relayA,
        [
          noteEvent(carol, base + 9),
          noteEvent(bob, base + 4),
          profileEvent(bob, JSON.stringify({ name: "bob" }), base + 1),
        ],
      ],
    ]);

    const exit = await runWith(
      stubTransport([], { stored }),
      Effect.flatMap(Profiles, (profiles) => profiles.discoverActiveProfiles()),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value).toEqual([
      expect.objectContaining({ pubkey: bob.pubkey }),
    ]);
  });

  it("scans with the default activity filter and honors option overrides", async () => {
    const defaultLog: Array<Filter> = [];
    await runWith(
      stubTransport([], { fetchLog: defaultLog }),
      Effect.flatMap(Profiles, (profiles) => profiles.discoverActiveProfiles()),
    );
    expect(defaultLog[0]).toEqual({
      kinds: [0, 1, 6, 7, 9735, 30315],
      limit: 64,
      since: expect.any(Number),
    });

    const overrideLog: Array<Filter> = [];
    await runWith(
      stubTransport([], { fetchLog: overrideLog }),
      Effect.flatMap(Profiles, (profiles) =>
        profiles.discoverActiveProfiles({
          activityKinds: [1],
          activeWindowSeconds: 3600,
          authorScanLimit: 5,
        }),
      ),
    );
    const overrideFilter = overrideLog[0];
    expect(overrideFilter).toEqual({
      kinds: [1],
      limit: 5,
      since: expect.any(Number),
    });
    const defaultSince = defaultLog[0]?.since ?? 0;
    const overrideSince = overrideFilter?.since ?? 0;
    // Runs moments apart, so the windows differ by 45 days minus one hour.
    const windowDelta = 45 * 24 * 60 * 60 - 3600;
    expect(overrideSince - defaultSince).toBeGreaterThanOrEqual(windowDelta);
    expect(overrideSince - defaultSince).toBeLessThanOrEqual(windowDelta + 5);
  });

  it("chunks the profile lookup when the activity scan spans many authors", async () => {
    const identities = Array.from(
      { length: AUTHOR_FILTER_LIMIT + 1 },
      makeIdentity,
    );
    const stored = new Map<RelayUrl, ReadonlyArray<NostrToolsEvent>>([
      [
        relayA,
        identities.map((identity, index) =>
          noteEvent(identity, base + index + 1),
        ),
      ],
    ]);
    const fetchLog: Array<Filter> = [];

    const exit = await runWith(
      stubTransport([], { stored, fetchLog }),
      Effect.flatMap(Profiles, (profiles) => profiles.discoverActiveProfiles()),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    const lookupFilters = fetchLog.filter((filter) => filter.authors);
    const authorCounts = lookupFilters
      .map((filter) => filter.authors?.length ?? 0)
      .sort((a, b) => a - b);
    // Two chunks, each queried on both relays, per-chunk limit preserved.
    expect(authorCounts).toEqual([
      1,
      1,
      AUTHOR_FILTER_LIMIT,
      AUTHOR_FILTER_LIMIT,
    ]);
    for (const filter of lookupFilters) {
      expect(filter.limit).toBe((filter.authors?.length ?? 0) * 2);
    }
  });

  it("returns an empty list when no recent activity is found", async () => {
    const fetchLog: Array<Filter> = [];
    const exit = await runWith(
      stubTransport([], { fetchLog }),
      Effect.flatMap(Profiles, (profiles) => profiles.discoverActiveProfiles()),
    );
    expect(exit).toEqual(Exit.succeed([]));
    // No authors, so the kind-0 stage is skipped: one activity fetch per relay.
    expect(fetchLog).toHaveLength(2);
  });
});

describe("Profiles.searchProfiles", () => {
  const searchRelay = RelayUrl.make("wss://search.test");
  const otherSearchRelay = RelayUrl.make("wss://search-2.test");

  it("sends the NIP-50 filter only to the search relays and dedupes authors newest-first", async () => {
    const fetchLog: Array<Filter> = [];
    const stored = new Map<RelayUrl, ReadonlyArray<NostrToolsEvent>>([
      [relayA, [profileEvent(carol, JSON.stringify({ name: "alice" }), base)]],
      [
        searchRelay,
        [
          profileEvent(bob, JSON.stringify({ name: "Alice Bobson" }), base + 1),
          profileEvent(bob, JSON.stringify({ name: "old bob" }), base),
          profileEvent(
            alice,
            JSON.stringify({ display_name: "ALICE" }),
            base + 2,
          ),
        ],
      ],
    ]);

    const exit = await runWith(
      stubTransport([], { fetchLog, stored }),
      Effect.flatMap(Profiles, (profiles) =>
        profiles.searchProfiles("alice", { searchRelays: [searchRelay] }),
      ),
      [relayA],
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.map((hit) => hit.pubkey)).toEqual([
      alice.pubkey,
      bob.pubkey,
    ]);
    expect(exit.value[0]?.metadata.displayName).toBe("ALICE");
    expect(exit.value[1]?.metadata.name).toBe("Alice Bobson");
    // The plain query plus a prefix-wildcard companion, each to the search
    // relay only.
    expect(fetchLog).toEqual([
      { kinds: [0], search: "alice", limit: 24 },
      { kinds: [0], search: "alice*", limit: 24 },
    ]);
  });

  it("skips the wildcard companion for short words and explicit search syntax", async () => {
    const fetchLog: Array<Filter> = [];
    const stored = new Map<RelayUrl, ReadonlyArray<NostrToolsEvent>>([
      [relayA, [profileEvent(alice, JSON.stringify({ name: "al" }), base)]],
    ]);
    const run = (query: string) =>
      runWith(
        stubTransport([], { fetchLog, stored }),
        Effect.flatMap(Profiles, (profiles) => profiles.searchProfiles(query)),
        [relayA],
      );

    await run("al");
    await run('"alice smith"');
    await run("ali*");
    expect(fetchLog.map((filter) => filter.search)).toEqual([
      "al",
      '"alice smith"',
      "ali*",
    ]);
  });

  it("ranks profiles on a preferred domain above every other hit", async () => {
    const stored = new Map<RelayUrl, ReadonlyArray<NostrToolsEvent>>([
      [
        relayA,
        [
          profileEvent(alice, JSON.stringify({ name: "sat" }), base + 2),
          profileEvent(
            bob,
            JSON.stringify({ name: "satoshi", lud16: "npub1x@linky.fit" }),
            base + 1,
          ),
          profileEvent(
            carol,
            JSON.stringify({ name: "sats", nip05: "carol@Linky.fit" }),
            base,
          ),
        ],
      ],
    ]);

    const exit = await runWith(
      stubTransport([], { stored }),
      Effect.flatMap(Profiles, (profiles) =>
        profiles.searchProfiles("sat", { preferredDomains: ["linky.fit"] }),
      ),
      [relayA],
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    // alice's exact name match loses to the two linky users; among them both
    // are prefix matches and carol's nip05 outweighs bob's relay position.
    expect(exit.value.map((hit) => hit.pubkey)).toEqual([
      carol.pubkey,
      bob.pubkey,
      alice.pubkey,
    ]);
  });

  it("falls back to the read relays when no search relays are configured", async () => {
    const fetchLog: Array<Filter> = [];
    const stored = new Map<RelayUrl, ReadonlyArray<NostrToolsEvent>>([
      [relayA, [profileEvent(alice, JSON.stringify({ name: "alice" }), base)]],
      // A relay without NIP-50 ignores `search` and answers with anything.
      [relayB, [profileEvent(carol, JSON.stringify({ name: "carol" }), base)]],
    ]);

    const exit = await runWith(
      stubTransport([], { fetchLog, stored }),
      Effect.flatMap(Profiles, (profiles) => profiles.searchProfiles("alice")),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    expect(exit.value.map((hit) => hit.pubkey)).toEqual([alice.pubkey]);
    expect(fetchLog).toHaveLength(4);
  });

  it("matches ignoring accents and word order, including the about text", async () => {
    const stored = new Map<RelayUrl, ReadonlyArray<NostrToolsEvent>>([
      [
        relayA,
        [
          profileEvent(alice, JSON.stringify({ name: "Hynek Jína" }), base + 2),
          profileEvent(
            bob,
            JSON.stringify({ display_name: "Jína Hynek" }),
            base + 1,
          ),
          profileEvent(
            carol,
            JSON.stringify({ name: "carol", about: "friend of hynek jina" }),
            base,
          ),
        ],
      ],
    ]);

    const exit = await runWith(
      stubTransport([], { stored }),
      Effect.flatMap(Profiles, (profiles) =>
        profiles.searchProfiles("hynek jina"),
      ),
      [relayA],
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    expect(exit.value.map((hit) => hit.pubkey)).toEqual([
      alice.pubkey,
      bob.pubkey,
      carol.pubkey,
    ]);
  });

  it("ranks exact and prefix name matches above word matches", async () => {
    const stored = new Map<RelayUrl, ReadonlyArray<NostrToolsEvent>>([
      [
        relayA,
        [
          profileEvent(alice, JSON.stringify({ name: "blackjack" }), base + 3),
          profileEvent(bob, JSON.stringify({ name: "jackson" }), base + 2),
          profileEvent(carol, JSON.stringify({ display_name: "Jack" }), base),
        ],
      ],
    ]);

    const exit = await runWith(
      stubTransport([], { stored }),
      Effect.flatMap(Profiles, (profiles) => profiles.searchProfiles("jack")),
      [relayA],
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.map((hit) => hit.pubkey)).toEqual([
      carol.pubkey,
      bob.pubkey,
      alice.pubkey,
    ]);
  });

  it("keeps relay order within a tier and prefers profiles with nip05 or picture", async () => {
    const stored = new Map<RelayUrl, ReadonlyArray<NostrToolsEvent>>([
      [
        relayA,
        [
          profileEvent(alice, JSON.stringify({ name: "sat alice" }), base),
          profileEvent(
            bob,
            JSON.stringify({ name: "sat bob", nip05: "bob@linky.fit" }),
            base + 1,
          ),
          profileEvent(carol, JSON.stringify({ name: "sat carol" }), base + 2),
        ],
      ],
    ]);

    const exit = await runWith(
      stubTransport([], { stored }),
      Effect.flatMap(Profiles, (profiles) => profiles.searchProfiles("sat")),
      [relayA],
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    // bob jumps ahead on nip05; alice stays before carol on relay position
    // even though carol's profile is newer.
    expect(exit.value.map((hit) => hit.pubkey)).toEqual([
      bob.pubkey,
      alice.pubkey,
      carol.pubkey,
    ]);
  });

  it("caps the hits at the requested limit", async () => {
    const stored = new Map<RelayUrl, ReadonlyArray<NostrToolsEvent>>([
      [
        relayA,
        [alice, bob, carol].map((identity, index) =>
          profileEvent(
            identity,
            JSON.stringify({ name: `sat-${index}` }),
            base + index,
          ),
        ),
      ],
    ]);

    const exit = await runWith(
      stubTransport([], { stored }),
      Effect.flatMap(Profiles, (profiles) =>
        profiles.searchProfiles("sat", { limit: 2 }),
      ),
      [relayA],
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value).toHaveLength(2);
    expect(exit.value[0]?.pubkey).toBe(alice.pubkey);
  });

  it("reports ranked hits after every relay answer", async () => {
    const stored = new Map<RelayUrl, ReadonlyArray<NostrToolsEvent>>([
      [
        searchRelay,
        [profileEvent(alice, JSON.stringify({ name: "sat a" }), base)],
      ],
      [
        otherSearchRelay,
        [profileEvent(bob, JSON.stringify({ name: "sat b" }), base + 1)],
      ],
    ]);
    const progress: Array<Array<Pubkey>> = [];

    const exit = await runWith(
      stubTransport([], { stored }),
      Effect.flatMap(Profiles, (profiles) =>
        profiles.searchProfiles("sat", {
          searchRelays: [searchRelay, otherSearchRelay],
          onHits: (hits) => progress.push(hits.map((hit) => hit.pubkey)),
        }),
      ),
      [],
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    // One report per answer (two relays × plain + wildcard query); equal
    // relevance, so bob's newer profile ranks first once it arrives.
    expect(progress).toHaveLength(4);
    expect(progress[0]).toEqual([alice.pubkey]);
    expect(progress.at(-1)).toEqual([bob.pubkey, alice.pubkey]);
  });

  it("returns what arrived when a relay is still silent at the deadline", async () => {
    const stored = new Map<RelayUrl, ReadonlyArray<NostrToolsEvent>>([
      [
        searchRelay,
        [profileEvent(alice, JSON.stringify({ name: "sat" }), base)],
      ],
    ]);

    const exit = await runWith(
      stubTransport([], { stored, silent: [otherSearchRelay] }),
      Effect.flatMap(Profiles, (profiles) =>
        profiles.searchProfiles("sat", {
          searchRelays: [searchRelay, otherSearchRelay],
          deadline: "20 millis",
        }),
      ),
      [],
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    expect(exit.value.map((hit) => hit.pubkey)).toEqual([alice.pubkey]);
  });

  it("fails when every search relay is unreachable or silent past the deadline", async () => {
    const exit = await runWith(
      stubTransport([], {
        unreachable: [searchRelay],
        silent: [otherSearchRelay],
      }),
      Effect.flatMap(Profiles, (profiles) =>
        profiles.searchProfiles("sat", {
          searchRelays: [searchRelay, otherSearchRelay],
          deadline: "20 millis",
        }),
      ),
      [],
    );
    expect(exit).toEqual(
      Exit.fail(expect.objectContaining({ _tag: "AllRelaysUnreachable" })),
    );
  });
});

describe("Profiles read guards", () => {
  const reads: ReadonlyArray<{
    readonly name: string;
    readonly read: (
      profiles: Profiles,
    ) => Effect.Effect<unknown, { readonly _tag: string }>;
  }> = [
    { name: "fetchProfile", read: (p) => p.fetchProfile(bob.pubkey) },
    { name: "fetchProfiles", read: (p) => p.fetchProfiles([bob.pubkey]) },
    {
      name: "discoverActiveProfiles",
      read: (p) => p.discoverActiveProfiles(),
    },
    { name: "searchProfiles", read: (p) => p.searchProfiles("alice") },
  ];

  it.each(reads)(
    "$name fails with NoReadRelaysConfigured without read relays",
    async ({ read }) => {
      const exit = await runWith(
        stubTransport([]),
        Effect.flatMap(Profiles, read),
        [],
      );
      expect(exit).toEqual(
        Exit.fail(expect.objectContaining({ _tag: "NoReadRelaysConfigured" })),
      );
    },
  );

  it.each(reads.filter(({ name }) => name !== "searchProfiles"))(
    "$name fails with AllRelaysUnreachable when no relay answers",
    async ({ read }) => {
      const exit = await runWith(
        stubTransport([], { unreachable: [relayA, relayB] }),
        Effect.flatMap(Profiles, read),
      );
      expect(exit).toEqual(
        Exit.fail(
          expect.objectContaining({
            _tag: "AllRelaysUnreachable",
            failures: [
              expect.objectContaining({ relay: relayA, detail: "down" }),
              expect.objectContaining({ relay: relayB, detail: "down" }),
            ],
          }),
        ),
      );
    },
  );
});
