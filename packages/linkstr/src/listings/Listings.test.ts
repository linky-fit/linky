import { Effect, Exit, Layer, Result, Schema, Stream } from "effect";
import type { Event as NostrToolsEvent, Filter } from "nostr-tools";
import { getConversationKey } from "nostr-tools/nip44";
import { PrivateImage } from "../chat/domain";
import { RelayUrl, UnixSeconds } from "../domain/primitives";
import type { Pubkey } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import type { InspectorEvent } from "../inspector/events";
import {
  AUTHOR_FILTER_LIMIT,
  REQUEST_FILTER_LIMIT,
} from "../internal/authorChunks";
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
  encodeListingsEvents,
  LISTINGS_KIND,
  LISTINGS_MAX_EVENT_BYTES,
  listingsChunkOf,
  listingsSlotId,
} from "./codec";
import {
  emptyListingsDocument,
  LISTING_DESCRIPTION_MAX_LENGTH,
  Listing,
  ListingAmount,
  ListingCurrency,
  ListingsAudience,
  ListingsDocument,
  ListingsDraft,
  SharedListing,
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
): SignedPlainEvent => {
  const [event] = chunkEvents(author, recipients, createdAt, content);
  if (event === undefined) throw new Error("a publish has a chunk");
  return event;
};

/** Every chunk of one publish, signed with the publish's one `created_at`. */
const chunkEvents = (
  author: LinkstrIdentityService,
  recipients: ReadonlyArray<Pubkey>,
  createdAt: number,
  content: ListingsDocument = document,
): Array<SignedPlainEvent> =>
  encodeListingsEvents(
    new ListingsDraft({ document: content, recipients }),
    author.secretKey,
  ).map((template) =>
    signPlainEvent(template, UnixSeconds.make(createdAt), author.secretKey),
  );

/** Enough contacts that one event would pass the relay size cap. */
const crowd = Array.from({ length: 300 }, makeIdentity);
/** Encoded once: every slot costs an ECDH, too slow to repeat per test on CI. */
const crowdEvents = chunkEvents(
  alice,
  crowd.map(({ pubkey }) => pubkey),
  base,
);
/** A sample of the crowd, since every decode costs an ECDH per chunk. */
const sampledReaders = crowd.filter((_, index) => index % 15 === 0);

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
        ...encodeListingsEvents(
          new ListingsDraft({ document, recipients: [bob.pubkey] }),
          alice.secretKey,
        )[0],
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

const listingImage = new PrivateImage({
  url: "https://blossom.test/abc",
  fileType: "image/jpeg",
  encryptionAlgorithm: "aes-gcm",
  key: "a".repeat(64),
  nonce: "b".repeat(24),
  encryptedSha256: "c".repeat(64),
  originalSha256: "d".repeat(64),
  encryptedSize: 1024,
  width: 800,
  height: 600,
  storageEncoding: "base64",
});

describe("listing image", () => {
  const image = listingImage;
  const decodeDocument = Schema.decodeUnknownSync(ListingsDocument);
  const encodedEggs = Schema.encodeSync(Listing)(eggs);

  it("carries the image to every reader and leaves it out when absent", () => {
    const withImage = new ListingsDocument({
      listings: [new Listing({ ...eggs, image })],
    });
    const event = listingsEvent(alice, [bob.pubkey], base, withImage);
    expect(
      documentOf(decodeListingsEvent(event, bob.secretKey))?.listings[0]?.image,
    ).toEqual(image);
    expect("image" in encodedEggs).toBe(false);
  });

  it("keeps a listing whose image is malformed, without the image", () => {
    const decoded = decodeDocument({
      listings: [{ ...encodedEggs, image: { url: "https://blossom.test" } }],
    });
    expect(decoded.listings).toHaveLength(1);
    expect(decoded.listings[0]?.title).toBe(eggs.title);
    expect(decoded.listings[0] && "image" in decoded.listings[0]).toBe(false);
  });
});

describe("listing description", () => {
  const encodedEggs = Schema.encodeSync(Listing)(eggs);
  const descriptionOf = (description: unknown) =>
    Schema.decodeUnknownSync(Listing)({ ...encodedEggs, description });

  it("carries the description to every reader and leaves it out when absent", () => {
    const withDescription = new ListingsDocument({
      listings: [descriptionOf("Free range.\nPick up in Brno.")],
    });
    const event = listingsEvent(alice, [bob.pubkey], base, withDescription);
    expect(
      documentOf(decodeListingsEvent(event, bob.secretKey))?.listings[0]
        ?.description,
    ).toBe("Free range.\nPick up in Brno.");
    expect("description" in encodedEggs).toBe(false);
  });

  it.each([
    ["empty", "   "],
    ["too long", "a".repeat(LISTING_DESCRIPTION_MAX_LENGTH + 1)],
    ["not text", 42],
  ])("keeps a listing whose description is %s, without it", (_, value) => {
    const listing = descriptionOf(value);
    expect(listing.title).toBe(eggs.title);
    expect("description" in listing).toBe(false);
  });
});

describe("listing audiences", () => {
  const honey = new Listing({ ...eggs, id: "honey", title: "Med" });
  const audienceEvents = (recipients: ReadonlyArray<Pubkey>) =>
    encodeListingsEvents(
      new ListingsDraft({
        document,
        recipients,
        audiences: [
          new ListingsAudience({ listings: [honey], recipients: [bob.pubkey] }),
        ],
      }),
      alice.secretKey,
    ).map((template) =>
      signPlainEvent(template, UnixSeconds.make(base), alice.secretKey),
    );

  it("lets only the audience read its listings, after the document's", () => {
    const [event] = audienceEvents([bob.pubkey, carol.pubkey]);
    if (event === undefined) throw new Error("a publish has a chunk");
    expect(event.content).not.toContain("Med");
    expect(
      documentOf(decodeListingsEvent(event, bob.secretKey))?.listings,
    ).toEqual([eggs, honey]);
    expect(documentOf(decodeListingsEvent(event, carol.secretKey))).toEqual(
      document,
    );
  });

  it("gives an audience member outside the recipients nothing", () => {
    const [event] = audienceEvents([carol.pubkey]);
    if (event === undefined) throw new Error("a publish has a chunk");
    expect(documentOf(decodeListingsEvent(event, bob.secretKey))).toEqual(
      emptyListingsDocument,
    );
  });

  it("gives every slot part keys of one length, so a relay cannot tell the members", () => {
    const [event] = audienceEvents([bob.pubkey, carol.pubkey]);
    if (event === undefined) throw new Error("a publish has a chunk");
    const lengths = event.tags
      .filter((tag) => tag[0] === "slot")
      .map((tag) => tag[3]?.length);
    expect(lengths).toHaveLength(2);
    expect(new Set(lengths).size).toBe(1);
    expect(lengths[0]).toBeGreaterThan(0);
  });

  it("keeps the content key where a reader without parts looks for it", () => {
    const [event] = audienceEvents([bob.pubkey]);
    if (event === undefined) throw new Error("a publish has a chunk");
    const withoutParts = signPlainEvent(
      {
        kind: event.kind,
        content: event.content,
        tags: event.tags
          .filter((tag) => tag[0] !== "part")
          .map((tag) => (tag[0] === "slot" ? tag.slice(0, 3) : tag)),
      },
      UnixSeconds.make(base),
      alice.secretKey,
    );
    expect(
      documentOf(decodeListingsEvent(withoutParts, bob.secretKey)),
    ).toEqual(document);
  });
});

describe("network listings", () => {
  const decodeDocument = Schema.decodeUnknownSync(ListingsDocument);
  const encodedEggs = Schema.encodeSync(Listing)(eggs);

  it("carries the reach and the passed-on listings to the reader", () => {
    const passedOn = new SharedListing({ author: carol.pubkey, listing: eggs });
    const networked = new ListingsDocument({
      listings: [new Listing({ ...eggs, reach: "network" })],
      passedOn: [passedOn],
    });
    const event = listingsEvent(alice, [bob.pubkey], base, networked);
    const read = documentOf(decodeListingsEvent(event, bob.secretKey));
    expect(read?.listings[0]?.reach).toBe("network");
    expect(read?.passedOn).toEqual([passedOn]);
  });

  it("passes on only as many listings as leave room for the slots, first ones first", () => {
    const long = (index: number) =>
      new SharedListing({
        author: carol.pubkey,
        listing: new Listing({
          ...eggs,
          id: `long-${index}`,
          description: "x".repeat(LISTING_DESCRIPTION_MAX_LENGTH),
        }),
      });
    const passedOn = Array.from({ length: 200 }, (_, index) => long(index));
    const events = chunkEvents(
      alice,
      [bob.pubkey],
      base,
      new ListingsDocument({ listings: [eggs], passedOn }),
    );
    for (const event of events) {
      expect(JSON.stringify(event).length).toBeLessThanOrEqual(
        LISTINGS_MAX_EVENT_BYTES,
      );
    }
    const [event] = events;
    if (event === undefined) throw new Error("a publish has a chunk");
    const read = documentOf(decodeListingsEvent(event, bob.secretKey));
    expect(read?.listings).toEqual([eggs]);
    const kept = read?.passedOn ?? [];
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(passedOn.length);
    expect(kept).toEqual(passedOn.slice(0, kept.length));
  });

  it("drops an unknown reach and a malformed passed-on list, keeping the rest", () => {
    const decoded = decodeDocument({
      listings: [{ ...encodedEggs, reach: "everyone" }],
      passedOn: [{ author: "nope", listing: encodedEggs }],
    });
    expect(decoded.listings[0]?.title).toBe(eggs.title);
    expect(decoded.listings[0] && "reach" in decoded.listings[0]).toBe(false);
    expect("passedOn" in decoded).toBe(false);
  });
});

describe("listings chunks", () => {
  it("keeps a small publish in one event without a chunks tag", () => {
    const events = chunkEvents(alice, [bob.pubkey, carol.pubkey], base);
    expect(events).toHaveLength(1);
    expect(events[0]?.tags.find((tag) => tag[0] === "chunks")).toBeUndefined();
  });

  it("splits a publish too large for one event so every reader decodes only its own chunk", () => {
    const events = crowdEvents;
    expect(events.length).toBeGreaterThan(1);
    expect(events.map((event) => event.tags[0])).toEqual(
      events.map((_, chunk) => [
        "d",
        chunk === 0 ? "listings" : `listings:${chunk}`,
      ]),
    );
    for (const event of events) {
      expect(JSON.stringify(event).length).toBeLessThan(
        LISTINGS_MAX_EVENT_BYTES,
      );
      expect(event.tags).toContainEqual(["chunks", String(events.length)]);
    }
    const readable = (reader: LinkstrIdentityService) => {
      const results = events.map((event) =>
        decodeListingsEvent(event, reader.secretKey),
      );
      expect(results.filter(Result.isFailure).map(dropReason)).toEqual(
        Array.from({ length: events.length - 1 }, () => "other-chunk"),
      );
      return results.filter(Result.isSuccess).map(documentOf);
    };
    for (const reader of sampledReaders) {
      expect(readable(reader)).toEqual([document]);
    }
    expect(readable(makeIdentity())).toEqual([emptyListingsDocument]);
  });

  it("drops a chunk past the publish's chunk count", () => {
    const event = signPlainEvent(
      {
        kind: LISTINGS_KIND,
        tags: [
          ["d", "listings:2"],
          ["chunks", "2"],
        ],
        content: "",
      },
      UnixSeconds.make(base),
      alice.secretKey,
    );
    expect(dropReason(decodeListingsEvent(event, bob.secretKey))).toBe(
      "malformed-chunk",
    );
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

describe("Listings.publish chunks", () => {
  it("publishes every chunk with one created_at", async () => {
    const published: Array<SignedPlainEvent> = [];
    const exit = await Effect.runPromiseExit(
      Effect.flatMap(Listings, (listings) =>
        listings.publish(
          new ListingsDraft({
            document,
            recipients: crowd.map(({ pubkey }) => pubkey),
          }),
        ),
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
    expect(published.length).toBeGreaterThan(1);
    expect(new Set(published.map((event) => event.created_at)).size).toBe(1);
  }, 20_000);
});

interface FakeSubscription {
  readonly relay: RelayUrl;
  readonly filters: ReadonlyArray<Filter>;
  readonly onEvent: (event: NostrToolsEvent) => void;
}

const watchTransport = (
  subscriptions: Array<FakeSubscription>,
): NostrTransportService => ({
  publish: () => Effect.die("publish not under test"),
  subscribe: (relay, filters, onEvent) =>
    Effect.suspend(() => {
      subscriptions.push({ relay, filters, onEvent });
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
    const expected =
      Math.ceil(
        Math.ceil(new Set(pubkeys).size / AUTHOR_FILTER_LIMIT) /
          REQUEST_FILTER_LIMIT,
      ) * 2;
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
          subscriptions.map(({ relay, filters }) => ({ relay, filters })),
        ).toEqual(
          [relayA, relayB].map((relay) => ({
            relay,
            filters: [{ kinds: [LISTINGS_KIND], authors: [alice.pubkey] }],
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

  it("keeps a listing photo's key and nonce out of the routed inspector event", () =>
    withWatch(bob, [alice.pubkey], ({ inspected, subscriptions }) =>
      Effect.gen(function* () {
        const withImage = new ListingsDocument({
          listings: [new Listing({ ...eggs, image: listingImage })],
        });
        subscriptions[0]?.onEvent(
          listingsEvent(alice, [bob.pubkey], base, withImage),
        );
        const routed = () =>
          inspected.filter((event) => event._tag === "ProfileWatchRouted");
        yield* eventually(() =>
          JSON.stringify(routed()).includes(listingImage.url),
        );
        expect(JSON.stringify(routed())).not.toContain(listingImage.key);
        expect(JSON.stringify(routed())).not.toContain(listingImage.nonce);
      }),
    ));

  it("decides only on the chunk that carries the reader's slot", () => {
    const events = crowdEvents;
    const chunkOfReader = (reader: LinkstrIdentityService) =>
      listingsChunkOf(
        listingsSlotId(getConversationKey(reader.secretKey, alice.pubkey)),
        events.length,
      );
    const reader = crowd.find((member) => chunkOfReader(member) !== 0);
    if (reader === undefined) throw new Error("every reader is in chunk 0");
    return withWatch(
      reader,
      [alice.pubkey],
      ({ facts, inspected, subscriptions }) =>
        Effect.gen(function* () {
          for (const event of events) subscriptions[0]?.onEvent(event);
          yield* eventually(
            () =>
              facts.length === 1 &&
              droppedWith(inspected).length === events.length - 1,
          );
          expect(facts[0]?.document).toEqual(document);
          expect(
            new Set(droppedWith(inspected).map((drop) => drop.reason)),
          ).toEqual(new Set(["other-chunk"]));
        }),
    );
  });
});
