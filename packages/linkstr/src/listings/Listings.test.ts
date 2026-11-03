import { Effect, Exit, Layer, Result, Stream } from "effect";
import type { Event as NostrToolsEvent, Filter } from "nostr-tools";
import { getConversationKey } from "nostr-tools/nip44";
import { RelayUrl, UnixSeconds } from "../domain/primitives";
import type { Pubkey } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import type { InspectorEvent } from "../inspector/events";
import { AUTHOR_FILTER_LIMIT } from "../internal/authorChunks";
import { signPlainEvent } from "../internal/plainEvent";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import { NostrTransport } from "../services/NostrTransport";
import type { NostrTransportService } from "../services/NostrTransport";
import type { LinkstrIdentityService } from "../services/LinkstrIdentity";
import { RelayPolicy } from "../services/RelayPolicy";
import { eventually, makeIdentity, stubPlainTransport } from "../testing";
import type { SignedPlainEvent } from "../testing";
import {
  decodeListingsEvent,
  encodeListingsEvent,
  LISTINGS_KIND,
  listingsSlotId,
} from "./codec";
import {
  emptyListingsDocument,
  Listing,
  ListingAmount,
  ListingCurrency,
  ListingsDocument,
  ListingsDraft,
} from "./domain";
import { ListingsEventDropped } from "./events";
import type { ListingsUpdated } from "./events";
import { Listings } from "./Listings";

const alice = makeIdentity();
const bob = makeIdentity();
const carol = makeIdentity();
const relayA = RelayUrl.make("wss://relay-a.test");
const relayB = RelayUrl.make("wss://relay-b.test");
const base = 1_754_000_000;

const eggs = new Listing({
  id: "eggs",
  side: "offer",
  title: "Domácí vajíčka",
  amount: ListingAmount.make("90"),
  currency: ListingCurrency.make("CZK"),
  unit: "za 10 ks",
});

const document = new ListingsDocument({ cash: "offer", listings: [eggs] });

const dropReason = <A, E>(result: Result.Result<A, E>): E | null =>
  Result.isFailure(result) ? result.failure : null;
const documentOf = <A, E>(result: Result.Result<A, E>): A | null =>
  Result.isSuccess(result) ? result.success : null;

const listingsEvent = (
  author: LinkstrIdentityService,
  recipients: ReadonlyArray<Pubkey>,
  createdAt: number,
  content: ListingsDocument = document,
): SignedPlainEvent =>
  signPlainEvent(
    encodeListingsEvent(
      new ListingsDraft({ document: content, recipients }),
      author.secretKey,
    ),
    UnixSeconds.make(createdAt),
    author.secretKey,
  );

describe("listings codec", () => {
  it("lets every recipient, and nobody else, read the document", () => {
    const event = listingsEvent(alice, [bob.pubkey, carol.pubkey], base);
    expect(event.kind).toBe(LISTINGS_KIND);
    expect(event.tags.slice(0, 2)).toEqual([
      ["d", "listings"],
      ["linky", "listings"],
    ]);
    expect(event.tags.filter((tag) => tag[0] === "slot")).toHaveLength(2);
    expect(event.content).not.toContain("vajíčka");

    for (const reader of [bob, carol]) {
      expect(documentOf(decodeListingsEvent(event, reader.secretKey))).toEqual(
        document,
      );
    }
    const stranger = makeIdentity();
    expect(documentOf(decodeListingsEvent(event, stranger.secretKey))).toEqual(
      emptyListingsDocument,
    );
    // The author keeps no slot for themselves.
    expect(documentOf(decodeListingsEvent(event, alice.secretKey))).toEqual(
      emptyListingsDocument,
    );
  });

  it("derives the same slot id on both sides and keeps it opaque", () => {
    const event = listingsEvent(alice, [bob.pubkey], base);
    const slot = event.tags.find((tag) => tag[0] === "slot");
    // The same ECDH secret from either side.
    const fromBob = listingsSlotId(
      getConversationKey(bob.secretKey, alice.pubkey),
    );
    expect(slot?.[1]).toBe(fromBob);
    expect(slot?.[1]).toHaveLength(32);
    expect(slot?.[1]).not.toContain(bob.pubkey.slice(0, 8));
  });

  it("uses a fresh content key per publish, so a dropped recipient sees the next version as empty", () => {
    const first = listingsEvent(alice, [bob.pubkey, carol.pubkey], base);
    const second = listingsEvent(alice, [bob.pubkey], base + 1);
    expect(first.content).not.toBe(second.content);
    expect(documentOf(decodeListingsEvent(second, carol.secretKey))).toEqual(
      emptyListingsDocument,
    );
    expect(documentOf(decodeListingsEvent(second, bob.secretKey))).toEqual(
      document,
    );
  });

  it("drops the wrong d tag and a document that does not decode", () => {
    const other = signPlainEvent(
      {
        ...encodeListingsEvent(
          new ListingsDraft({ document, recipients: [bob.pubkey] }),
          alice.secretKey,
        ),
        tags: [["d", "other"]],
      },
      UnixSeconds.make(base),
      alice.secretKey,
    );
    expect(dropReason(decodeListingsEvent(other, bob.secretKey))).toBe(
      "other-d-tag",
    );
    expect(
      () => new Listing({ ...eggs, amount: ListingAmount.make("1.234") }),
    ).toThrow();
  });
});

describe("Listings.publish", () => {
  it("signs one event per publish and dates a rapid second one past the first", async () => {
    const published: Array<SignedPlainEvent> = [];
    const exit = await Effect.runPromiseExit(
      Effect.flatMap(Listings, (listings) =>
        Effect.all([
          listings.publish(
            new ListingsDraft({ document, recipients: [bob.pubkey] }),
          ),
          listings.publish(
            new ListingsDraft({ document, recipients: [bob.pubkey] }),
          ),
        ]),
      ).pipe(
        Effect.provide(
          Listings.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                LinkstrIdentity.fromSecretKey(alice.secretKey),
                RelayPolicy.fixed({
                  readRelays: [relayA],
                  writeRelays: [relayA],
                }),
                stubPlainTransport(published),
              ),
            ),
          ),
        ),
      ),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(published).toHaveLength(2);
    expect(published[0]?.kind).toBe(LISTINGS_KIND);
    expect(published[1]?.created_at).toBe((published[0]?.created_at ?? 0) + 1);
  });
});

interface FakeSubscription {
  readonly relay: RelayUrl;
  readonly filter: Filter;
  readonly onEvent: (event: NostrToolsEvent) => void;
}

const watchTransport = (
  subscriptions: Array<FakeSubscription>,
): NostrTransportService => ({
  publish: () => Effect.die("publish not under test"),
  subscribe: (relay, filter, onEvent) =>
    Effect.suspend(() => {
      subscriptions.push({ relay, filter, onEvent });
      return Effect.never;
    }),
  fetch: () => Effect.die("fetch not under test"),
});

interface WatchContext {
  readonly subscriptions: Array<FakeSubscription>;
  readonly facts: Array<ListingsUpdated>;
  readonly inspected: Array<InspectorEvent>;
}

const withWatch = <A>(
  reader: LinkstrIdentityService,
  pubkeys: ReadonlyArray<Pubkey>,
  body: (context: WatchContext) => Effect.Effect<A, Error>,
): Promise<A> => {
  const subscriptions: Array<FakeSubscription> = [];
  const facts: Array<ListingsUpdated> = [];
  const inspected: Array<InspectorEvent> = [];
  return Effect.gen(function* () {
    const inspector = yield* Inspector;
    yield* Effect.forkScoped(
      Stream.runForEach(inspector.events, (event) =>
        Effect.sync(() => inspected.push(event)),
      ),
    );
    const listings = yield* Listings;
    const stream = yield* listings.watch(pubkeys);
    yield* Effect.forkScoped(
      Stream.runForEach(stream, (fact) => Effect.sync(() => facts.push(fact))),
    );
    const expected = Math.ceil(new Set(pubkeys).size / AUTHOR_FILTER_LIMIT) * 2;
    yield* eventually(() => subscriptions.length === expected);
    return yield* body({ subscriptions, facts, inspected });
  }).pipe(
    Effect.scoped,
    Effect.provide(
      Listings.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            LinkstrIdentity.fromSecretKey(reader.secretKey),
            Layer.succeed(NostrTransport, watchTransport(subscriptions)),
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
    event.event instanceof ListingsEventDropped
      ? [event.event]
      : [],
  );

describe("Listings.watch", () => {
  it("subscribes per relay and surfaces each author's newest readable document", () =>
    withWatch(bob, [alice.pubkey], ({ facts, inspected, subscriptions }) =>
      Effect.gen(function* () {
        expect(
          subscriptions.map(({ relay, filter }) => ({ relay, filter })),
        ).toEqual(
          [relayA, relayB].map((relay) => ({
            relay,
            filter: {
              kinds: [LISTINGS_KIND],
              authors: [alice.pubkey],
              "#d": ["listings"],
            },
          })),
        );

        const first = listingsEvent(alice, [bob.pubkey], base + 10);
        subscriptions[0]?.onEvent(first);
        yield* eventually(() => facts.length === 1);
        expect(facts[0]).toEqual(
          expect.objectContaining({
            _tag: "ListingsUpdated",
            pubkey: alice.pubkey,
            updatedAt: base + 10,
            document,
          }),
        );

        // A lagging relay replaying an older or equal event must not downgrade.
        subscriptions[1]?.onEvent(listingsEvent(alice, [bob.pubkey], base + 5));
        subscriptions[1]?.onEvent(first);
        const cleared = new ListingsDocument({});
        subscriptions[1]?.onEvent(
          listingsEvent(alice, [bob.pubkey], base + 20, cleared),
        );
        yield* eventually(() => facts.length === 2);
        expect(facts[1]?.document).toEqual(cleared);
        yield* eventually(
          () =>
            droppedWith(inspected).filter((drop) => drop.reason === "stale")
              .length === 2,
        );
      }),
    ));

  it("empties the document of an author who stops sharing with the reader and drops an unwatched author", () =>
    withWatch(bob, [alice.pubkey], ({ facts, inspected, subscriptions }) =>
      Effect.gen(function* () {
        subscriptions[0]?.onEvent(listingsEvent(alice, [bob.pubkey], base));
        yield* eventually(() => facts.length === 1);
        expect(facts[0]?.document).toEqual(document);
        subscriptions[0]?.onEvent(
          listingsEvent(alice, [carol.pubkey], base + 1),
        );
        yield* eventually(() => facts.length === 2);
        expect(facts[1]?.document).toEqual(emptyListingsDocument);
        subscriptions[0]?.onEvent(listingsEvent(carol, [bob.pubkey], base));
        yield* eventually(() => droppedWith(inspected).length === 1);
        expect(droppedWith(inspected).map((drop) => drop.reason)).toEqual([
          "unwatched-author",
        ]);
      }),
    ));
});
