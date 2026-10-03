import { Effect, Exit, Layer, Stream } from "effect";
import { finalizeEvent } from "nostr-tools";
import type { Event as NostrToolsEvent, Filter } from "nostr-tools";
import { RelayUrl, UnixSeconds } from "../domain/primitives";
import type { Pubkey } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import type { InspectorEvent } from "../inspector/events";
import { AUTHOR_FILTER_LIMIT } from "../internal/authorChunks";
import { NostrTransport, RelayUnreachable } from "../services/NostrTransport";
import type { NostrTransportService } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import type { LinkstrIdentityService } from "../services/LinkstrIdentity";
import { eventually, makeIdentity } from "../testing";
import { ProfileEventDropped } from "./events";
import type { ProfileWatchEvent } from "./events";
import { ProfileWatch } from "./ProfileWatch";

const alice = makeIdentity();
const carol = makeIdentity();

const relayA = RelayUrl.make("wss://relay-a.test");
const relayB = RelayUrl.make("wss://relay-b.test");

const base = 1_754_000_000;
const inOneHour = UnixSeconds.make(Math.floor(Date.now() / 1000) + 3600);

const profileEvent = (
  identity: LinkstrIdentityService,
  content: string,
  createdAt: number,
): NostrToolsEvent =>
  finalizeEvent(
    { kind: 0, tags: [], content, created_at: createdAt },
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

interface FakeSubscription {
  readonly relay: RelayUrl;
  readonly filter: Filter;
  readonly onEvent: (event: NostrToolsEvent) => void;
}

const watchTransport = (
  subscriptions: Array<FakeSubscription>,
  fetch: NostrTransportService["fetch"] = () =>
    Effect.die("fetch not under test"),
): NostrTransportService => ({
  publish: () => Effect.die("publish not under test"),
  subscribe: (relay, filter, onEvent) =>
    Effect.suspend(() => {
      subscriptions.push({ relay, filter, onEvent });
      return Effect.never;
    }),
  fetch,
});

interface WatchContext {
  readonly subscriptions: Array<FakeSubscription>;
  readonly facts: Array<ProfileWatchEvent>;
  readonly inspected: Array<InspectorEvent>;
}

interface SupporterBadgeWatch {
  readonly issuer: Pubkey;
  readonly fetch: NostrTransportService["fetch"];
}

const withWatch = <A>(
  pubkeys: ReadonlyArray<Pubkey>,
  body: (context: WatchContext) => Effect.Effect<A, Error>,
  badges?: SupporterBadgeWatch,
): Promise<A> => {
  const subscriptions: Array<FakeSubscription> = [];
  const facts: Array<ProfileWatchEvent> = [];
  const inspected: Array<InspectorEvent> = [];
  return Effect.gen(function* () {
    const inspector = yield* Inspector;
    yield* Effect.forkScoped(
      Stream.runForEach(inspector.events, (event) =>
        Effect.sync(() => inspected.push(event)),
      ),
    );
    const profileWatch = yield* ProfileWatch;
    const stream = yield* profileWatch.watch(
      pubkeys,
      badges === undefined ? {} : { supporterBadgeIssuer: badges.issuer },
    );
    yield* Effect.forkScoped(
      Stream.runForEach(stream, (fact) => Effect.sync(() => facts.push(fact))),
    );
    const expectedSubscriptions =
      Math.ceil(new Set(pubkeys).size / AUTHOR_FILTER_LIMIT) *
      (badges === undefined ? 2 : 3) *
      2;
    yield* eventually(() => subscriptions.length === expectedSubscriptions);
    return yield* body({ subscriptions, facts, inspected });
  }).pipe(
    Effect.scoped,
    Effect.provide(
      ProfileWatch.Default.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            Layer.succeed(
              NostrTransport,
              watchTransport(subscriptions, badges?.fetch),
            ),
            RelayPolicy.fixed({
              readRelays: [relayA, relayB],
              writeRelays: [],
            }),
          ),
        ),
        Layer.provideMerge(Inspector.live),
      ),
    ),
    Effect.runPromise,
  );
};

const droppedWith = (inspected: ReadonlyArray<InspectorEvent>) =>
  inspected.flatMap((event) =>
    event._tag === "ProfileWatchRouted" &&
    event.event instanceof ProfileEventDropped
      ? [event.event]
      : [],
  );

describe("ProfileWatch", () => {
  it("subscribes per relay and routes profile events newest-wins", () =>
    withWatch([alice.pubkey], ({ facts, inspected, subscriptions }) =>
      Effect.gen(function* () {
        expect(
          subscriptions.map(({ relay, filter }) => ({ relay, filter })),
        ).toEqual(
          [relayA, relayB].flatMap((relay) => [
            { relay, filter: { kinds: [0], authors: [alice.pubkey] } },
            { relay, filter: { kinds: [30315], authors: [alice.pubkey] } },
          ]),
        );

        const first = profileEvent(
          alice,
          JSON.stringify({ name: "alice", display_name: "Alice" }),
          base + 10,
        );
        subscriptions[0]?.onEvent(first);
        yield* eventually(() => facts.length === 1);
        expect(facts[0]).toEqual(
          expect.objectContaining({
            _tag: "ProfileUpdated",
            pubkey: alice.pubkey,
            updatedAt: base + 10,
            metadata: expect.objectContaining({
              name: "alice",
              displayName: "Alice",
            }),
          }),
        );

        // A lagging relay replaying an older or equal event must not downgrade.
        subscriptions[1]?.onEvent(
          profileEvent(alice, JSON.stringify({ name: "old" }), base + 5),
        );
        subscriptions[1]?.onEvent(first);
        const newer = profileEvent(
          alice,
          JSON.stringify({ name: "newer" }),
          base + 20,
        );
        subscriptions[1]?.onEvent(newer);
        yield* eventually(() => facts.length === 2);
        expect(facts[1]).toEqual(
          expect.objectContaining({
            _tag: "ProfileUpdated",
            updatedAt: base + 20,
          }),
        );
        expect(
          droppedWith(inspected).filter((drop) => drop.reason === "stale"),
        ).toHaveLength(2);
      }),
    ));

  it("splits a large pubkey set into filter chunks on every relay", () => {
    const extras = Array.from({ length: AUTHOR_FILTER_LIMIT }, makeIdentity);
    const overflow = extras[extras.length - 1];
    if (overflow === undefined) throw new Error("no extras generated");

    return withWatch(
      [alice.pubkey, ...extras.map((identity) => identity.pubkey)],
      ({ facts, subscriptions }) =>
        Effect.gen(function* () {
          expect(subscriptions).toHaveLength(8);
          for (const relay of [relayA, relayB]) {
            const authorCounts = subscriptions
              .filter((subscription) => subscription.relay === relay)
              .map((subscription) => subscription.filter.authors?.length ?? 0)
              .sort((a, b) => a - b);
            expect(authorCounts).toEqual([
              1,
              1,
              AUTHOR_FILTER_LIMIT,
              AUTHOR_FILTER_LIMIT,
            ]);
          }

          // An author from the overflow chunk still routes to a fact.
          const overflowSubscription = subscriptions.find((subscription) =>
            subscription.filter.authors?.includes(overflow.pubkey),
          );
          assert(overflowSubscription !== undefined);
          overflowSubscription.onEvent(
            profileEvent(overflow, JSON.stringify({ name: "overflow" }), base),
          );
          yield* eventually(() => facts.length === 1);
          expect(facts[0]).toEqual(
            expect.objectContaining({
              _tag: "ProfileUpdated",
              pubkey: overflow.pubkey,
            }),
          );
        }),
    );
  });

  it("drops malformed kind-0 content without ending the stream", () =>
    withWatch([alice.pubkey], ({ facts, inspected, subscriptions }) =>
      Effect.gen(function* () {
        subscriptions[0]?.onEvent(profileEvent(alice, "not json", base + 1));
        subscriptions[0]?.onEvent(profileEvent(alice, '"a string"', base + 2));
        subscriptions[0]?.onEvent(
          profileEvent(alice, JSON.stringify({ name: "ok" }), base + 3),
        );
        yield* eventually(() => facts.length === 1);
        expect(facts[0]).toEqual(
          expect.objectContaining({ _tag: "ProfileUpdated" }),
        );
        expect(
          droppedWith(inspected).filter(
            (drop) => drop.reason === "malformed-profile",
          ),
        ).toHaveLength(2);
      }),
    ));

  it("only surfaces live d=general statuses", () =>
    withWatch([alice.pubkey], ({ facts, inspected, subscriptions }) =>
      Effect.gen(function* () {
        subscriptions[0]?.onEvent(
          statusEvent(alice, "🎧 music", base + 1, [["d", "music"]]),
        );
        subscriptions[0]?.onEvent(
          statusEvent(alice, "gone", base + 2, [
            ["d", "general"],
            ["expiration", String(base + 3)],
          ]),
        );
        subscriptions[0]?.onEvent(
          statusEvent(alice, "21000 sats", base + 4, [
            ["d", "general"],
            ["expiration", String(inOneHour)],
          ]),
        );
        yield* eventually(() => facts.length === 1);
        expect(facts[0]).toEqual(
          expect.objectContaining({
            _tag: "StatusUpdated",
            pubkey: alice.pubkey,
            content: "21000 sats",
            expiresAt: inOneHour,
            updatedAt: base + 4,
          }),
        );
        const reasons = droppedWith(inspected).map((drop) => drop.reason);
        expect(reasons).toContain("other-d-tag");
        expect(reasons).toContain("expired");
      }),
    ));

  it("drops unwatched authors, tampered events and unsupported kinds", () =>
    withWatch([alice.pubkey], ({ facts, inspected, subscriptions }) =>
      Effect.gen(function* () {
        subscriptions[0]?.onEvent(
          profileEvent(carol, JSON.stringify({ name: "carol" }), base + 1),
        );
        subscriptions[0]?.onEvent({
          ...profileEvent(alice, JSON.stringify({ name: "real" }), base + 2),
          content: JSON.stringify({ name: "forged" }),
        });
        subscriptions[0]?.onEvent(
          finalizeEvent(
            { kind: 1, tags: [], content: "note", created_at: base + 3 },
            alice.secretKey,
          ),
        );
        yield* eventually(() => droppedWith(inspected).length === 3);
        expect(droppedWith(inspected).map((drop) => drop.reason)).toEqual([
          "unwatched-author",
          "invalid-signature",
          "unsupported-kind",
        ]);
        expect(facts).toHaveLength(0);
      }),
    ));
});

describe("ProfileWatch without read relays", () => {
  describe("with a supporter badge issuer", () => {
    const bot = makeIdentity();
    const stranger = makeIdentity();

    const award = (badge: string, signer = bot) =>
      finalizeEvent(
        {
          kind: 8,
          tags: [
            ["a", `30009:${bot.pubkey}:${badge}`],
            ["p", alice.pubkey],
          ],
          content: "",
          created_at: base,
        },
        signer.secretKey,
      );
    const gold = award("linky-supporter-gold");
    const generic = award("linky-supporter");
    const forged = award("linky-supporter-diamond", stranger);
    const profileBadges = (
      createdAt: number,
      pairs: ReadonlyArray<readonly [string, NostrToolsEvent]>,
    ) =>
      finalizeEvent(
        {
          kind: 30008,
          tags: [
            ["d", "profile_badges"],
            ...pairs.flatMap(([badge, event]) => [
              ["a", `30009:${bot.pubkey}:${badge}`],
              ["e", event.id],
            ]),
          ],
          content: "",
          created_at: createdAt,
        },
        alice.secretKey,
      );

    it("pairs profile badges with their verified awards, newest wins", () => {
      const fetched: Array<Filter> = [];
      return withWatch(
        [alice.pubkey],
        ({ facts, inspected, subscriptions }) =>
          Effect.gen(function* () {
            const badgeSubscriptions = subscriptions.filter(({ filter }) =>
              filter.kinds?.includes(30008),
            );
            expect(badgeSubscriptions.map(({ filter }) => filter)).toEqual([
              {
                kinds: [30008],
                authors: [alice.pubkey],
                "#d": ["profile_badges"],
              },
              {
                kinds: [30008],
                authors: [alice.pubkey],
                "#d": ["profile_badges"],
              },
            ]);

            badgeSubscriptions[0]?.onEvent(
              profileBadges(base + 10, [
                ["linky-supporter-gold", gold],
                ["linky-supporter", generic],
                ["linky-supporter-silver", gold],
                ["linky-supporter-diamond", forged],
              ]),
            );
            yield* eventually(() => facts.length === 1);
            expect(facts[0]).toEqual(
              expect.objectContaining({
                _tag: "SupporterBadgesUpdated",
                pubkey: alice.pubkey,
                updatedAt: base + 10,
                awards: [
                  expect.objectContaining({
                    badge: "gold",
                    awardedAt: base,
                  }),
                  expect.objectContaining({ badge: "generic" }),
                ],
              }),
            );
            expect(fetched[0]).toEqual(
              expect.objectContaining({
                kinds: [8],
                authors: [bot.pubkey],
              }),
            );
            expect(droppedWith(inspected).map(({ reason }) => reason)).toEqual([
              "award-mismatch",
              "award-missing",
            ]);

            // Older and equal events are stale; a newer one without Linky
            // entries clears the badges without fetching.
            badgeSubscriptions[1]?.onEvent(profileBadges(base + 5, []));
            badgeSubscriptions[1]?.onEvent(profileBadges(base + 20, []));
            yield* eventually(() => facts.length === 2);
            expect(facts[1]).toEqual(
              expect.objectContaining({
                _tag: "SupporterBadgesUpdated",
                awards: [],
                updatedAt: base + 20,
              }),
            );
            expect(fetched).toHaveLength(2);
          }),
        {
          issuer: bot.pubkey,
          fetch: (_relay, filter) =>
            Effect.sync(() => {
              fetched.push(filter);
              // The forged award is not served: a relay honours `authors`.
              return [gold, generic];
            }),
        },
      );
    });

    it("retries the badges while a silent relay may hold a missing award", () => {
      let relayBAnswers = false;
      return withWatch(
        [alice.pubkey],
        ({ facts, inspected, subscriptions }) =>
          Effect.gen(function* () {
            const badgeSubscription = subscriptions.find(({ filter }) =>
              filter.kinds?.includes(30008),
            );
            const badges = profileBadges(base + 10, [
              ["linky-supporter-gold", gold],
            ]);
            badgeSubscription?.onEvent(badges);
            yield* eventually(() => droppedWith(inspected).length === 1);
            expect(droppedWith(inspected)[0]?.reason).toBe(
              "awards-unreachable",
            );
            expect(facts).toEqual([]);

            relayBAnswers = true;
            badgeSubscription?.onEvent(badges);
            yield* eventually(() => facts.length === 1);
            expect(facts[0]).toEqual(
              expect.objectContaining({
                awards: [expect.objectContaining({ badge: "gold" })],
              }),
            );
          }),
        {
          issuer: bot.pubkey,
          fetch: (relay) =>
            relay === relayA
              ? Effect.succeed([])
              : relayBAnswers
                ? Effect.succeed([gold])
                : Effect.fail(
                    new RelayUnreachable({ relay, detail: "timed out" }),
                  ),
        },
      );
    });

    it("keeps an award when one relay serves a tampered copy", () =>
      withWatch(
        [alice.pubkey],
        ({ facts, subscriptions }) =>
          Effect.gen(function* () {
            subscriptions
              .find(({ filter }) => filter.kinds?.includes(30008))
              ?.onEvent(
                profileBadges(base + 10, [["linky-supporter-gold", gold]]),
              );
            yield* eventually(() => facts.length === 1);
            expect(facts[0]).toEqual(
              expect.objectContaining({
                awards: [expect.objectContaining({ badge: "gold" })],
              }),
            );
          }),
        {
          issuer: bot.pubkey,
          fetch: (relay) =>
            Effect.succeed(
              relay === relayA ? [{ ...gold, content: "tampered" }] : [gold],
            ),
        },
      ));
  });

  it("fails with NoReadRelaysConfigured", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.flatMap(ProfileWatch, (profileWatch) =>
          profileWatch.watch([alice.pubkey]),
        ),
      ).pipe(
        Effect.provide(
          ProfileWatch.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(NostrTransport, watchTransport([])),
                RelayPolicy.fixed({ readRelays: [], writeRelays: [] }),
              ),
            ),
          ),
        ),
      ),
    );
    expect(exit).toEqual(
      Exit.fail(expect.objectContaining({ _tag: "NoReadRelaysConfigured" })),
    );
  });
});
