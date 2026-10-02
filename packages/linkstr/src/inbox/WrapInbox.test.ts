import {
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Scope,
  Stream,
} from "effect";
import { finalizeEvent, generateSecretKey, getEventHash } from "nostr-tools";
import { encrypt, getConversationKey } from "nostr-tools/nip44";
import { createSeal } from "nostr-tools/nip59";
import type { Event as NostrToolsEvent, Filter } from "nostr-tools";
import { encodeBankOfferRumor } from "../bankOffers/codec";
import { BankOfferDraft, BankOfferId } from "../bankOffers/domain";
import {
  ClientId,
  RelayUrl,
  RumorId,
  UnixSeconds,
  WrapId,
} from "../domain/primitives";
import { wrapRumorFor } from "../internal/giftWrap";
import { Rumor } from "../internal/nostrEvent";
import type { NostrTags } from "../internal/nostrEvent";
import { encodePaymentNoticeRumor } from "../paymentNotices/codec";
import { PaymentNoticeDraft } from "../paymentNotices/domain";
import { encodeReactionRumor } from "../reactions/codec";
import { Emoji, ReactionDraft } from "../reactions/domain";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import {
  makeRelayPoolTransport,
  NostrTransport,
  RelayUnreachable,
} from "../services/NostrTransport";
import type { NostrTransportService } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import { eventually, FakeRelay, makeIdentity, poolFor } from "../testing";
import { InboxCursorStore } from "./InboxCursorStore";
import {
  MAX_BACKFILL_AGE_SECONDS,
  NIP59_BACKDATE_MARGIN_SECONDS,
  WrapInbox,
} from "./WrapInbox";
import type {
  DeliveredInboxEvent,
  WrapInboxEvent,
  WrapInboxFeed,
} from "./WrapInbox";

const alice = makeIdentity();
const bob = makeIdentity();
const carol = makeIdentity();

const relayA = RelayUrl.make("wss://relay-a.test");
const relayB = RelayUrl.make("wss://relay-b.test");

const sentAt = UnixSeconds.make(1_754_000_000);
const nowSec = () => Math.floor(Date.now() / 1000);
const hoursAgo = (hours: number) => UnixSeconds.make(nowSec() - hours * 3600);

const reactionWrap = (emoji: string, recipient = alice.pubkey) => {
  const rumor = encodeReactionRumor(
    new ReactionDraft({
      to: alice.pubkey,
      target: RumorId.make("ab".repeat(32)),
      targetKind: "text",
      targetAuthor: alice.pubkey,
      emoji: Emoji.make(emoji),
    }),
    bob.pubkey,
    sentAt,
    ClientId.make("client-1"),
  );
  return wrapRumorFor(rumor, bob.secretKey, recipient);
};

const chatWrap = () => {
  const fields = {
    pubkey: bob.pubkey,
    created_at: sentAt,
    kind: 14,
    tags: [["p", alice.pubkey]] satisfies NostrTags,
    content: "hello",
  };
  const rumor = new Rumor({ ...fields, id: getEventHash(fields) });
  return wrapRumorFor(rumor, bob.secretKey, alice.pubkey);
};

const paymentNoticeWrap = () => {
  const rumor = encodePaymentNoticeRumor(
    new PaymentNoticeDraft({ to: alice.pubkey }),
    bob.pubkey,
    sentAt,
    ClientId.make("payment-client"),
  );
  return wrapRumorFor(rumor, bob.secretKey, alice.pubkey, {
    pushMarker: true,
  });
};

const bankOfferWrap = (own: boolean, invalid = false) => {
  const author = own ? alice : bob;
  const peer = own ? bob : alice;
  const encoded = encodeBankOfferRumor(
    new BankOfferDraft({
      to: peer.pubkey,
      offerId: BankOfferId.make("offer-inbox"),
      offerer: author.pubkey,
      status: "offered",
      amountText: "1 000 Kč",
      text: "Zaplatíš za mě bankovní platbu?",
    }),
    author.pubkey,
    sentAt,
    ClientId.make("bank-offer-client"),
  );
  const rumor = invalid ? withRumorContent(encoded, "{}") : encoded;
  return wrapRumorFor(rumor, author.secretKey, alice.pubkey);
};

/** Two wraps whose randomized NIP-59 timestamps differ, oldest first. */
const distinctlyTimedWraps = (): [NostrToolsEvent, NostrToolsEvent] => {
  for (;;) {
    const [first, second] = [reactionWrap("👍"), reactionWrap("🔥")].sort(
      (a, b) => a.created_at - b.created_at,
    );
    if (
      first !== undefined &&
      second !== undefined &&
      first.created_at < second.created_at
    )
      return [first, second];
  }
};

const withRumorContent = (rumor: Rumor, content: string): Rumor => {
  const fields = {
    pubkey: rumor.pubkey,
    created_at: rumor.created_at,
    kind: rumor.kind,
    tags: rumor.tags,
    content,
  };
  return new Rumor({ ...fields, id: getEventHash(fields) });
};

const recordingCursorStore = (initial: UnixSeconds | null = null) => {
  const saved: Array<UnixSeconds> = [];
  let cursor = initial;
  const layer = Layer.succeed(InboxCursorStore, {
    load: Effect.sync(() => cursor),
    save: (next: UnixSeconds) =>
      Effect.sync(() => {
        cursor = next;
        saved.push(next);
      }),
  });
  return { layer, saved };
};

interface FetchCall {
  readonly filter: Filter;
  readonly relay: RelayUrl;
}

/** Page size a relay serves at most, whatever `limit` asks for. */
const RELAY_PAGE_CAP = 3;

/** A relay's stored wraps served like a relay would: newest first, capped. */
const storedPage = (
  stored: ReadonlyArray<NostrToolsEvent>,
  filter: Filter,
): Array<NostrToolsEvent> =>
  stored
    .filter(
      (wrap) =>
        wrap.created_at >= (filter.since ?? 0) &&
        wrap.created_at <= (filter.until ?? Number.MAX_SAFE_INTEGER),
    )
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, Math.min(RELAY_PAGE_CAP, filter.limit ?? RELAY_PAGE_CAP));

interface Backfill {
  /** Each relay's stored wraps, served to the backfill walk. */
  readonly stored?: ReadonlyMap<RelayUrl, ReadonlyArray<NostrToolsEvent>>;
  /** Records every page the walk asked for. */
  readonly pages?: Array<FetchCall>;
  /** Replaces the stored-wrap fetch, e.g. to hold a page back. */
  readonly fetch?: NostrTransportService["fetch"];
}

const dependenciesFor = (
  fakes: Array<[RelayUrl, FakeRelay]>,
  cursorStore: Layer.Layer<InboxCursorStore> = InboxCursorStore.inMemory,
  backfill: Backfill = {},
) =>
  WrapInbox.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        LinkstrIdentity.fromSecretKey(alice.secretKey),
        RelayPolicy.fixed({
          readRelays: fakes.map(([url]) => url),
          writeRelays: [],
        }),
        Layer.succeed(NostrTransport, {
          ...makeRelayPoolTransport(poolFor(new Map(fakes))),
          fetch:
            backfill.fetch ??
            ((relay, filter) =>
              Effect.sync(() => {
                backfill.pages?.push({ relay, filter });
                return storedPage(backfill.stored?.get(relay) ?? [], filter);
              })),
        }),
        cursorStore,
      ),
    ),
  );

interface Harness {
  readonly feed: WrapInboxFeed;
  readonly collected: Array<DeliveredInboxEvent>;
}

const eventsOf = (
  collected: ReadonlyArray<DeliveredInboxEvent>,
): Array<WrapInboxEvent> => collected.map((delivered) => delivered.event);

const runOpen = <A, E>(
  fakes: Array<[RelayUrl, FakeRelay]>,
  options: {
    since?: UnixSeconds;
    cursorStore?: Layer.Layer<InboxCursorStore>;
    /** Confirm every event as soon as it is collected; default true. */
    autoAck?: boolean;
    backfill?: Backfill;
  },
  body: (harness: Harness) => Effect.Effect<A, E>,
): Promise<A> =>
  Effect.gen(function* () {
    const inbox = yield* WrapInbox;
    const feed = yield* inbox.open({
      resubscribeDelay: Duration.millis(10),
      ...(options.since === undefined ? {} : { since: options.since }),
    });
    const collected: Array<DeliveredInboxEvent> = [];
    yield* Effect.forkScoped(
      Stream.runForEach(feed.events, (event) =>
        Effect.andThen(
          Effect.sync(() => collected.push(event)),
          options.autoAck === false ? Effect.void : event.ack,
        ),
      ),
    );
    return yield* body({ feed, collected });
  }).pipe(
    Effect.scoped,
    Effect.provide(
      dependenciesFor(fakes, options.cursorStore, options.backfill),
    ),
    Effect.runPromise,
  );

const fetchDependenciesFor = (
  readRelays: ReadonlyArray<RelayUrl>,
  stored: ReadonlyMap<RelayUrl, ReadonlyArray<NostrToolsEvent>>,
  calls: Array<FetchCall>,
) => {
  const transport: NostrTransportService = {
    publish: () => Effect.succeed([]),
    subscribe: () => Effect.never,
    fetch: (relay, filter) =>
      Effect.sync(() => {
        calls.push({ filter, relay });
        return stored.get(relay) ?? [];
      }),
  };
  return WrapInbox.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        LinkstrIdentity.fromSecretKey(alice.secretKey),
        RelayPolicy.fixed({ readRelays, writeRelays: [] }),
        Layer.succeed(NostrTransport, transport),
        InboxCursorStore.inMemory,
      ),
    ),
  );
};

const runFetch = (
  wrapId: WrapId,
  readRelays: ReadonlyArray<RelayUrl>,
  stored: ReadonlyMap<RelayUrl, ReadonlyArray<NostrToolsEvent>>,
  calls: Array<FetchCall>,
  extraRelays?: ReadonlyArray<RelayUrl>,
) =>
  Effect.gen(function* () {
    const inbox = yield* WrapInbox;
    return yield* inbox.fetchWrapEvent(
      wrapId,
      extraRelays === undefined ? undefined : { extraRelays },
    );
  }).pipe(
    Effect.provide(fetchDependenciesFor(readRelays, stored, calls)),
    Effect.runPromise,
  );

describe("WrapInbox.fetchWrapEvent", () => {
  it("fetches and decodes a chat wrap addressed to the identity", async () => {
    const wrap = chatWrap();
    const calls: Array<FetchCall> = [];

    const event = await runFetch(
      wrap.id,
      [relayA],
      new Map([[relayA, [wrap]]]),
      calls,
    );

    expect(calls).toEqual([
      {
        relay: relayA,
        filter: {
          ids: [wrap.id],
          kinds: [1059],
          "#p": [alice.pubkey],
          limit: 1,
        },
      },
    ]);
    expect(event).toEqual(
      expect.objectContaining({
        _tag: "ChatMessageReceived",
        from: bob.pubkey,
        body: expect.objectContaining({ _tag: "TextBody", text: "hello" }),
      }),
    );
  });

  it("returns null when reachable relays have no matching wrap", async () => {
    const event = await runFetch(
      WrapId.make("ab".repeat(32)),
      [relayA],
      new Map(),
      [],
    );

    expect(event).toBeNull();
  });

  it("queries extra relays in addition to configured read relays", async () => {
    const wrap = chatWrap();
    const calls: Array<FetchCall> = [];

    await runFetch(wrap.id, [relayA], new Map([[relayB, [wrap]]]), calls, [
      relayB,
    ]);

    expect(calls.map(({ relay }) => relay)).toEqual([relayA, relayB]);
  });

  it("uses extra relays when no read relays are configured", async () => {
    const wrap = chatWrap();
    const calls: Array<FetchCall> = [];

    const event = await runFetch(
      wrap.id,
      [],
      new Map([[relayB, [wrap]]]),
      calls,
      [relayB],
    );

    expect(event?._tag).toBe("ChatMessageReceived");
    expect(calls.map(({ relay }) => relay)).toEqual([relayB]);
  });

  it("fails only when configured and extra relay sets are both empty", async () => {
    const exit = await Effect.gen(function* () {
      const inbox = yield* WrapInbox;
      return yield* inbox.fetchWrapEvent(WrapId.make("ab".repeat(32)));
    }).pipe(
      Effect.provide(fetchDependenciesFor([], new Map(), [])),
      Effect.runPromiseExit,
    );

    expect(exit).toEqual(
      Exit.fail(expect.objectContaining({ _tag: "NoReadRelaysConfigured" })),
    );
  });

  it("resolves null when the fetch outlasts the timeout option", async () => {
    const transport: NostrTransportService = {
      publish: () => Effect.succeed([]),
      subscribe: () => Effect.never,
      fetch: () => Effect.never,
    };
    const dependencies = WrapInbox.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          LinkstrIdentity.fromSecretKey(alice.secretKey),
          RelayPolicy.fixed({ readRelays: [relayA], writeRelays: [] }),
          Layer.succeed(NostrTransport, transport),
          InboxCursorStore.inMemory,
        ),
      ),
    );

    const event = await Effect.gen(function* () {
      const inbox = yield* WrapInbox;
      return yield* inbox.fetchWrapEvent(WrapId.make("ab".repeat(32)), {
        timeout: Duration.millis(20),
      });
    }).pipe(Effect.provide(dependencies), Effect.runPromise);

    expect(event).toBeNull();
  });

  it("returns WrapDropped for a forged wrap", async () => {
    const wrap = chatWrap();
    const forged = { ...wrap, content: `${wrap.content}forged` };

    const event = await runFetch(
      wrap.id,
      [relayA],
      new Map([[relayA, [forged]]]),
      [],
    );

    expect(event).toEqual(
      expect.objectContaining({
        _tag: "WrapDropped",
        wrapId: wrap.id,
        reason: "invalid-wrap",
      }),
    );
  });
});

describe("WrapInbox", () => {
  it("fails to open when no read relays are configured", async () => {
    const exit = await Effect.gen(function* () {
      const inbox = yield* WrapInbox;
      return yield* inbox.open();
    }).pipe(
      Effect.scoped,
      Effect.provide(dependenciesFor([])),
      Effect.runPromiseExit,
    );

    expect(exit).toEqual(
      Exit.fail(expect.objectContaining({ _tag: "NoReadRelaysConfigured" })),
    );
  });

  it("subscribes with the gift-wrap filter and emits ReactionAdded", async () => {
    const fakeA = new FakeRelay();
    const wrap = reactionWrap("👍");
    const store = recordingCursorStore();

    await runOpen(
      [[relayA, fakeA]],
      { cursorStore: store.layer },
      ({ collected }) =>
        Effect.gen(function* () {
          yield* eventually(() => fakeA.subscriptions.length === 1);
          expect(fakeA.subscriptions[0]?.filters).toEqual([
            {
              kinds: [1059],
              "#p": [alice.pubkey],
              since: expect.any(Number),
              limit: 1,
            },
          ]);

          fakeA.emit(wrap);
          fakeA.eose();
          yield* eventually(() => collected.length === 1);
          expect(collected[0]?.event).toEqual(
            expect.objectContaining({
              _tag: "ReactionAdded",
              from: bob.pubkey,
              emoji: "👍",
              sentAt,
            }),
          );
          yield* eventually(() => store.saved.length === 1);
          expect(store.saved).toEqual([wrap.created_at]);
        }),
    );
  });

  it("prefers the stored cursor over the since fallback", async () => {
    const fakeA = new FakeRelay();
    const stored = hoursAgo(1);
    const store = recordingCursorStore(stored);

    await runOpen(
      [[relayA, fakeA]],
      { since: hoursAgo(2), cursorStore: store.layer },
      () =>
        Effect.gen(function* () {
          yield* eventually(() => fakeA.subscriptions.length === 1);
          expect(fakeA.subscriptions[0]?.filters[0]?.since).toBe(
            stored - NIP59_BACKDATE_MARGIN_SECONDS,
          );
        }),
    );
  });

  it("moves the cursor only once the consumer confirms the event", async () => {
    const fakeA = new FakeRelay();
    const wrap = reactionWrap("👍");
    const store = recordingCursorStore();

    await runOpen(
      [[relayA, fakeA]],
      { cursorStore: store.layer, autoAck: false },
      ({ collected }) =>
        Effect.gen(function* () {
          yield* eventually(() => fakeA.subscriptions.length === 1);
          fakeA.emit(wrap);
          fakeA.eose();
          yield* eventually(() => collected.length === 1);
          yield* Effect.sleep(Duration.millis(20));
          expect(store.saved).toEqual([]);

          const [delivered] = collected;
          assert(delivered !== undefined);
          yield* delivered.ack;
          yield* delivered.ack;
          expect(store.saved).toEqual([wrap.created_at]);
        }),
    );
  });

  it("holds the cursor while an older wrap delivered out of order is unconfirmed", async () => {
    const fakeA = new FakeRelay();
    const [older, newer] = distinctlyTimedWraps();
    const store = recordingCursorStore();

    await runOpen(
      [[relayA, fakeA]],
      { cursorStore: store.layer, autoAck: false },
      ({ collected }) =>
        Effect.gen(function* () {
          yield* eventually(() => fakeA.subscriptions.length === 1);
          fakeA.emit(newer);
          fakeA.emit(older);
          fakeA.eose();
          yield* eventually(() => collected.length === 2);
          yield* Effect.sleep(Duration.millis(20));

          const [newerEvent, olderEvent] = collected;
          assert(newerEvent !== undefined && olderEvent !== undefined);
          yield* newerEvent.ack;
          expect(store.saved).toEqual([]);

          yield* olderEvent.ack;
          expect(store.saved).toEqual([newer.created_at]);
        }),
    );
  });

  it("lets confirmed drops and deduped copies settle the cursor", async () => {
    const fakeA = new FakeRelay();
    const fakeB = new FakeRelay();
    const wrap = reactionWrap("👍");
    const store = recordingCursorStore();

    await runOpen(
      [
        [relayA, fakeA],
        [relayB, fakeB],
      ],
      { cursorStore: store.layer, autoAck: false },
      ({ collected }) =>
        Effect.gen(function* () {
          yield* eventually(
            () =>
              fakeA.subscriptions.length === 1 &&
              fakeB.subscriptions.length === 1,
          );
          fakeA.emit(wrap);
          fakeB.emit(wrap);
          fakeA.emit({ ...wrap, id: "ff".repeat(32) });
          fakeA.eose();
          fakeB.eose();
          yield* eventually(() => collected.length === 2);
          yield* Effect.sleep(Duration.millis(20));
          expect(collected[1]?.event).toEqual(
            expect.objectContaining({ _tag: "WrapDropped" }),
          );

          yield* Effect.forEach(collected, (delivered) => delivered.ack);
          expect(store.saved).toEqual([wrap.created_at]);
        }),
    );
  });

  it("dedupes the same wrap arriving on two relays", async () => {
    const fakeA = new FakeRelay();
    const fakeB = new FakeRelay();
    const wrap = reactionWrap("👍");
    const laterWrap = reactionWrap("🔥");

    await runOpen(
      [
        [relayA, fakeA],
        [relayB, fakeB],
      ],
      {},
      ({ collected }) =>
        Effect.gen(function* () {
          yield* eventually(
            () =>
              fakeA.subscriptions.length === 1 &&
              fakeB.subscriptions.length === 1,
          );
          fakeA.emit(wrap);
          fakeB.emit(wrap);
          fakeB.emit(laterWrap);
          yield* eventually(() => collected.length === 2);
          expect(eventsOf(collected)).toEqual([
            expect.objectContaining({ _tag: "ReactionAdded", emoji: "👍" }),
            expect.objectContaining({ _tag: "ReactionAdded", emoji: "🔥" }),
          ]);
        }),
    );
  });

  it("surfaces misaddressed, forged and malformed wraps as WrapDropped", async () => {
    const fakeA = new FakeRelay();
    const misaddressed = reactionWrap("👍", carol.pubkey);
    const authentic = reactionWrap("🔥");
    const forged = { ...authentic, id: authentic.id, content: "not-a-seal" };

    await runOpen([[relayA, fakeA]], {}, ({ collected }) =>
      Effect.gen(function* () {
        yield* eventually(() => fakeA.subscriptions.length === 1);
        fakeA.emit(misaddressed);
        fakeA.emit(forged);
        fakeA.emit({
          id: "not-hex",
          pubkey: alice.pubkey,
          created_at: 1,
          kind: 1059,
          tags: [],
          content: "x",
          sig: "x",
        });
        yield* eventually(() => collected.length === 3);
        expect(eventsOf(collected)).toEqual([
          expect.objectContaining({
            _tag: "WrapDropped",
            wrapId: misaddressed.id,
            reason: "not-addressed-to-me",
          }),
          expect.objectContaining({
            _tag: "WrapDropped",
            wrapId: authentic.id,
            reason: "invalid-wrap",
          }),
          expect.objectContaining({
            _tag: "WrapDropped",
            wrapId: null,
            reason: "malformed-wrap",
          }),
        ]);
      }),
    );
  });

  it("does not let a tampered copy suppress the honest wrap from another relay", async () => {
    const fakeA = new FakeRelay();
    const fakeB = new FakeRelay();
    const wrap = reactionWrap("👍");
    const tampered = { ...wrap, content: "not-a-seal" };

    await runOpen(
      [
        [relayA, fakeA],
        [relayB, fakeB],
      ],
      {},
      ({ collected }) =>
        Effect.gen(function* () {
          yield* eventually(
            () =>
              fakeA.subscriptions.length === 1 &&
              fakeB.subscriptions.length === 1,
          );
          fakeA.emit(tampered);
          yield* eventually(() => collected.length === 1);
          fakeB.emit(wrap);
          yield* eventually(() => collected.length === 2);
          expect(eventsOf(collected)).toEqual([
            expect.objectContaining({
              _tag: "WrapDropped",
              wrapId: wrap.id,
              reason: "invalid-wrap",
            }),
            expect.objectContaining({ _tag: "ReactionAdded", emoji: "👍" }),
          ]);
        }),
    );
  });

  it("routes a wrapped kind-14 rumor to ChatMessageReceived", async () => {
    const fakeA = new FakeRelay();
    const wrap = chatWrap();

    await runOpen([[relayA, fakeA]], {}, ({ collected }) =>
      Effect.gen(function* () {
        yield* eventually(() => fakeA.subscriptions.length === 1);
        fakeA.emit(wrap);
        yield* eventually(() => collected.length === 1);
        expect(collected[0]?.event).toEqual(
          expect.objectContaining({
            _tag: "ChatMessageReceived",
            from: bob.pubkey,
            body: expect.objectContaining({ _tag: "TextBody", text: "hello" }),
            sentAt,
          }),
        );
      }),
    );
  });

  it("routes a wrapped kind-24133 rumor to PaymentNoticeReceived", async () => {
    const fakeA = new FakeRelay();
    const wrap = paymentNoticeWrap();

    await runOpen([[relayA, fakeA]], {}, ({ collected }) =>
      Effect.gen(function* () {
        yield* eventually(() => fakeA.subscriptions.length === 1);
        fakeA.emit(wrap);
        yield* eventually(() => collected.length === 1);
        expect(collected[0]?.event).toEqual(
          expect.objectContaining({
            _tag: "PaymentNoticeReceived",
            from: bob.pubkey,
            context: null,
            offerId: null,
            sentAt,
          }),
        );
      }),
    );
  });

  it("routes a wrapped kind-24135 rumor to BankOfferSnapshotReceived", async () => {
    const fakeA = new FakeRelay();
    const wrap = bankOfferWrap(false);

    await runOpen([[relayA, fakeA]], {}, ({ collected }) =>
      Effect.gen(function* () {
        yield* eventually(() => fakeA.subscriptions.length === 1);
        fakeA.emit(wrap);
        yield* eventually(() => collected.length === 1);
        expect(collected[0]?.event).toEqual(
          expect.objectContaining({
            _tag: "BankOfferSnapshotReceived",
            from: bob.pubkey,
            offerId: "offer-inbox",
            offerer: bob.pubkey,
            status: "offered",
            amountText: "1 000 Kč",
            clientId: "bank-offer-client",
            sentAt,
          }),
        );
      }),
    );
  });

  it("drops an invalid wrapped bank offer with its vertical reason", async () => {
    const fakeA = new FakeRelay();
    const wrap = bankOfferWrap(false, true);

    await runOpen([[relayA, fakeA]], {}, ({ collected }) =>
      Effect.gen(function* () {
        yield* eventually(() => fakeA.subscriptions.length === 1);
        fakeA.emit(wrap);
        yield* eventually(() => collected.length === 1);
        expect(collected[0]?.event).toEqual(
          expect.objectContaining({
            _tag: "WrapDropped",
            wrapId: wrap.id,
            reason: "invalid-bank-offer",
          }),
        );
      }),
    );
  });

  it("routes an own bank offer snapshot as a confirmation instead of dropping it", async () => {
    const fakeA = new FakeRelay();
    const wrap = bankOfferWrap(true);

    await runOpen([[relayA, fakeA]], {}, ({ collected }) =>
      Effect.gen(function* () {
        yield* eventually(() => fakeA.subscriptions.length === 1);
        fakeA.emit(wrap);
        yield* eventually(() => collected.length === 1);
        expect(collected[0]?.event).toEqual(
          expect.objectContaining({
            _tag: "OwnBankOfferSnapshotConfirmed",
            to: bob.pubkey,
            offerId: "offer-inbox",
          }),
        );
      }),
    );
  });

  it("resubscribes after a relay-side close, backfilling from where the open started", async () => {
    const fakeA = new FakeRelay();
    const since = hoursAgo(72);
    const firstWrap = reactionWrap("👍");
    const secondWrap = reactionWrap("🔥");

    await runOpen([[relayA, fakeA]], { since }, ({ collected }) =>
      Effect.gen(function* () {
        yield* eventually(() => fakeA.subscriptions.length === 1);
        expect(fakeA.subscriptions[0]?.filters[0]?.since).toBe(
          since - NIP59_BACKDATE_MARGIN_SECONDS,
        );

        fakeA.emit(firstWrap);
        yield* eventually(() => collected.length === 1);

        fakeA.closeFromRelay("connection reset");
        yield* eventually(() => fakeA.subscriptions.length === 2);
        expect(fakeA.subscriptions[1]?.filters[0]?.since).toBe(
          since - NIP59_BACKDATE_MARGIN_SECONDS,
        );

        fakeA.emit(firstWrap);
        fakeA.emit(secondWrap);
        yield* eventually(() => collected.length === 2);
        expect(collected[1]?.event).toEqual(
          expect.objectContaining({ _tag: "ReactionAdded", emoji: "🔥" }),
        );
      }),
    );
  });

  it("keeps retrying a relay it cannot reach", async () => {
    const fakeA = new FakeRelay();
    fakeA.down = true;

    await runOpen([[relayA, fakeA]], {}, () =>
      eventually(() => fakeA.connectAttempts >= 2),
    );
    expect(fakeA.subscriptions).toHaveLength(0);
  });

  it("tags wraps backfill before EOSE and live after", async () => {
    const fakeA = new FakeRelay();
    const storedWrap = reactionWrap("👍");
    const liveWrap = reactionWrap("🔥");

    await runOpen([[relayA, fakeA]], {}, ({ collected }) =>
      Effect.gen(function* () {
        yield* eventually(() => fakeA.subscriptions.length === 1);
        fakeA.emit(storedWrap);
        fakeA.eose();
        fakeA.emit(liveWrap);
        yield* eventually(() => collected.length === 2);
        expect(collected).toEqual([
          expect.objectContaining({
            delivery: "backfill",
            event: expect.objectContaining({ emoji: "👍" }),
          }),
          expect.objectContaining({
            delivery: "live",
            event: expect.objectContaining({ emoji: "🔥" }),
          }),
        ]);
      }),
    );
  });

  it("returns to the backfill phase on every resubscription", async () => {
    const fakeA = new FakeRelay();
    const firstWrap = reactionWrap("👍");
    const secondWrap = reactionWrap("🔥");

    await runOpen([[relayA, fakeA]], {}, ({ collected }) =>
      Effect.gen(function* () {
        yield* eventually(() => fakeA.subscriptions.length === 1);
        fakeA.eose();
        fakeA.emit(firstWrap);
        yield* eventually(() => collected.length === 1);
        expect(collected[0]?.delivery).toBe("live");

        // The reconnected relay replays its stored window: backfill again.
        fakeA.closeFromRelay("connection reset");
        yield* eventually(() => fakeA.subscriptions.length === 2);
        fakeA.emit(secondWrap);
        yield* eventually(() => collected.length === 2);
        expect(collected[1]?.delivery).toBe("backfill");
      }),
    );
  });

  it("keeps the first arrival's phase for a wrap duplicated across relays", async () => {
    const fakeA = new FakeRelay();
    const fakeB = new FakeRelay();
    const wrap = reactionWrap("👍");
    const chaser = reactionWrap("🔥");

    await runOpen(
      [
        [relayA, fakeA],
        [relayB, fakeB],
      ],
      {},
      ({ collected }) =>
        Effect.gen(function* () {
          yield* eventually(
            () =>
              fakeA.subscriptions.length === 1 &&
              fakeB.subscriptions.length === 1,
          );
          fakeA.eose();
          fakeB.emit(wrap);
          yield* eventually(() => collected.length === 1);
          fakeA.emit(wrap);
          fakeA.emit(chaser);
          yield* eventually(() => collected.length === 2);
          expect(collected).toEqual([
            expect.objectContaining({
              delivery: "backfill",
              event: expect.objectContaining({ emoji: "👍" }),
            }),
            expect.objectContaining({
              delivery: "live",
              event: expect.objectContaining({ emoji: "🔥" }),
            }),
          ]);
        }),
    );
  });

  // Conservative failure mode: a mis-tagged backfill only costs a missed
  // interruption, never a spurious one. The pool transport bounds this by
  // synthesizing EOSE after nostr-tools' eose timeout.
  it("keeps tagging backfill when a relay never sends EOSE", async () => {
    const fakeA = new FakeRelay();
    const firstWrap = reactionWrap("👍");
    const secondWrap = reactionWrap("🔥");

    await runOpen([[relayA, fakeA]], {}, ({ collected }) =>
      Effect.gen(function* () {
        yield* eventually(() => fakeA.subscriptions.length === 1);
        fakeA.emit(firstWrap);
        fakeA.emit(secondWrap);
        yield* eventually(() => collected.length === 2);
        expect(collected.map((delivered) => delivered.delivery)).toEqual([
          "backfill",
          "backfill",
        ]);
      }),
    );
  });

  it("closes relay subscriptions and ends the stream when the scope closes", async () => {
    const fakeA = new FakeRelay();
    const fakeB = new FakeRelay();

    await Effect.gen(function* () {
      const inbox = yield* WrapInbox;
      const scope = yield* Scope.make();
      const feed = yield* inbox
        .open({ resubscribeDelay: Duration.millis(10) })
        .pipe(Scope.extend(scope));
      const consumer = yield* Effect.fork(Stream.runDrain(feed.events));
      yield* eventually(
        () =>
          fakeA.subscriptions.length === 1 && fakeB.subscriptions.length === 1,
      );

      yield* Scope.close(scope, Exit.void);
      yield* Fiber.join(consumer);

      expect(
        fakeA.subscriptions.every((subscription) => subscription.closed),
      ).toBe(true);
      expect(
        fakeB.subscriptions.every((subscription) => subscription.closed),
      ).toBe(true);
    }).pipe(
      Effect.provide(
        dependenciesFor([
          [relayA, fakeA],
          [relayB, fakeB],
        ]),
      ),
      Effect.runPromise,
    );
  });
});

describe("WrapInbox backfill", () => {
  const storedWraps = (count: number): Array<NostrToolsEvent> =>
    Array.from({ length: count }, (_, index) => reactionWrap(`${index}`));

  const chatWrapAt = (createdAt: number, text: string): NostrToolsEvent => {
    const fields = {
      pubkey: bob.pubkey,
      created_at: createdAt,
      kind: 14,
      tags: [["p", alice.pubkey]],
      content: text,
    };
    const rumor = { ...fields, id: getEventHash(fields) };
    const seal = createSeal(rumor, bob.secretKey, alice.pubkey);
    const secretKey = generateSecretKey();
    return finalizeEvent(
      {
        kind: 1059,
        created_at: createdAt,
        tags: [["p", alice.pubkey]],
        content: encrypt(
          JSON.stringify(seal),
          getConversationKey(secretKey, alice.pubkey),
        ),
      },
      secretKey,
    );
  };

  it.each([
    { boundaryCount: 200, relayCap: 500, incomplete: false },
    { boundaryCount: 201, relayCap: 200, incomplete: true },
  ])(
    "walks below $boundaryCount wraps sharing a second with relay cap $relayCap",
    async ({ boundaryCount, relayCap, incomplete }) => {
      const fakeA = new FakeRelay();
      const boundary = hoursAgo(4 * 24);
      const older = chatWrapAt(boundary - 3 * 24 * 3600, "older");
      const newest = chatWrapAt(nowSec(), "live");
      const stored = [
        ...Array.from({ length: boundaryCount }, (_, index) =>
          chatWrapAt(boundary, String(index)),
        ),
        older,
      ];
      const store = recordingCursorStore(hoursAgo(8 * 24));
      const fetch: NostrTransportService["fetch"] = (_relay, filter) =>
        Effect.succeed(
          stored
            .filter(
              (wrap) =>
                wrap.created_at >= (filter.since ?? 0) &&
                wrap.created_at <= (filter.until ?? Number.MAX_SAFE_INTEGER),
            )
            .slice(0, Math.min(relayCap, filter.limit ?? relayCap)),
        );

      await runOpen(
        [[relayA, fakeA]],
        { cursorStore: store.layer, backfill: { fetch } },
        ({ collected }) =>
          Effect.gen(function* () {
            yield* eventually(() => fakeA.subscriptions.length === 1);
            fakeA.eose();
            yield* eventually(() =>
              collected.some(({ wrapId }) => wrapId === older.id),
            );
            expect(collected).toHaveLength(201);
            expect(
              collected.every(
                ({ event }) => event._tag === "ChatMessageReceived",
              ),
            ).toBe(true);
            yield* eventually(() => store.saved.length > 0);

            fakeA.emit(newest);
            yield* eventually(() => collected.length === 202);
            yield* Effect.sleep(Duration.millis(20));
            expect(store.saved.at(-1)).toBe(
              incomplete ? boundary : newest.created_at,
            );
          }),
      );
    },
    30_000,
  );

  it("walks a relay's stored wraps back in pages past its result cap", async () => {
    const fakeA = new FakeRelay();
    const stored = storedWraps(7);
    const pages: Array<FetchCall> = [];
    const store = recordingCursorStore();

    await runOpen(
      [[relayA, fakeA]],
      {
        cursorStore: store.layer,
        backfill: { stored: new Map([[relayA, stored]]), pages },
      },
      ({ collected }) =>
        Effect.gen(function* () {
          yield* eventually(() => fakeA.subscriptions.length === 1);
          expect(pages).toEqual([]);
          fakeA.eose();
          yield* eventually(() => collected.length === 7);
          yield* eventually(() => store.saved.length === 1);

          expect(new Set(collected.map(({ delivery }) => delivery))).toEqual(
            new Set(["backfill"]),
          );
          const newestFirst = stored
            .map((wrap) => wrap.created_at)
            .sort((a, b) => b - a);
          expect(pages[0]?.filter).toEqual({
            kinds: [1059],
            "#p": [alice.pubkey],
            since: fakeA.subscriptions[0]?.filters[0]?.since,
            limit: 200,
          });
          expect(pages[1]?.filter.until).toBe(newestFirst[RELAY_PAGE_CAP - 1]);
          expect(store.saved).toEqual([newestFirst[0]]);
        }),
    );
  });

  it("retains an unresolved boundary after failed walks until a complete walk replaces it", async () => {
    const fakeA = new FakeRelay();
    const boundary = hoursAgo(4 * 24);
    const newest = chatWrapAt(nowSec(), "live");
    const stored = [
      ...Array.from({ length: 4 }, (_, index) =>
        chatWrapAt(boundary, String(index)),
      ),
      chatWrapAt(boundary - 3 * 24 * 3600, "older"),
    ];
    const store = recordingCursorStore(hoursAgo(8 * 24));
    let failures = 0;
    let recovered = false;
    const fetch: NostrTransportService["fetch"] = (relay, filter) =>
      Effect.suspend(() => {
        if (!recovered && (filter.until ?? boundary) < boundary) {
          failures++;
          return Effect.fail(new RelayUnreachable({ relay, detail: "reset" }));
        }
        return Effect.succeed(
          stored
            .filter(
              (wrap) =>
                wrap.created_at >= (filter.since ?? 0) &&
                wrap.created_at <= (filter.until ?? Number.MAX_SAFE_INTEGER),
            )
            .slice(0, Math.min(recovered ? 5 : 3, filter.limit ?? 5)),
        );
      });

    await runOpen(
      [[relayA, fakeA]],
      { cursorStore: store.layer, backfill: { fetch } },
      ({ collected }) =>
        Effect.gen(function* () {
          for (let attempt = 1; attempt <= 3; attempt++) {
            yield* eventually(() => fakeA.subscriptions.length === attempt);
            if (attempt === 1) fakeA.emit(newest);
            fakeA.eose();
            yield* eventually(() => failures === attempt);
          }
          yield* eventually(() => store.saved.length > 0);
          expect(store.saved.at(-1)).toBe(boundary);
          expect(collected).toHaveLength(4);

          recovered = true;
          yield* eventually(() => fakeA.subscriptions.length === 4);
          fakeA.eose();
          yield* eventually(() => store.saved.at(-1) === newest.created_at);
          expect(collected).toHaveLength(6);
        }),
    );
  });

  it("never reaches further back than the maximum backfill age", async () => {
    const fakeA = new FakeRelay();
    const ancient = hoursAgo(90 * 24);

    await runOpen(
      [[relayA, fakeA]],
      { cursorStore: recordingCursorStore(ancient).layer },
      () =>
        Effect.gen(function* () {
          yield* eventually(() => fakeA.subscriptions.length === 1);
          const since = fakeA.subscriptions[0]?.filters[0]?.since ?? 0;
          expect(
            Math.abs(since - (nowSec() - MAX_BACKFILL_AGE_SECONDS)),
          ).toBeLessThan(5);
        }),
    );
  });

  it("holds the cursor until the walk has finished", async () => {
    const fakeA = new FakeRelay();
    const [older, newer] = distinctlyTimedWraps();
    const store = recordingCursorStore();
    const lastPage = Effect.runSync(Deferred.make<void>());
    let fetches = 0;
    const fetch: NostrTransportService["fetch"] = () =>
      fetches++ === 0
        ? Effect.succeed([older])
        : Effect.as(Deferred.await(lastPage), []);

    await runOpen(
      [[relayA, fakeA]],
      { cursorStore: store.layer, backfill: { fetch } },
      ({ collected }) =>
        Effect.gen(function* () {
          yield* eventually(() => fakeA.subscriptions.length === 1);
          fakeA.eose();
          fakeA.emit(newer);
          yield* eventually(() => collected.length === 2 && fetches === 2);
          expect(store.saved).toEqual([]);

          yield* Deferred.succeed(lastPage, undefined);
          yield* eventually(() => store.saved.length === 1);
          expect(store.saved).toEqual([newer.created_at]);
        }),
    );
  });

  it("holds the cursor for a read relay that has not answered yet", async () => {
    const fakeA = new FakeRelay();
    const fakeB = new FakeRelay();
    const wrap = reactionWrap("👍");
    const store = recordingCursorStore();

    await runOpen(
      [
        [relayA, fakeA],
        [relayB, fakeB],
      ],
      { cursorStore: store.layer },
      ({ collected }) =>
        Effect.gen(function* () {
          yield* eventually(
            () =>
              fakeA.subscriptions.length === 1 &&
              fakeB.subscriptions.length === 1,
          );
          fakeA.emit(wrap);
          fakeA.eose();
          yield* eventually(() => collected.length === 1);
          yield* Effect.sleep(Duration.millis(20));
          expect(store.saved).toEqual([]);

          fakeB.eose();
          yield* eventually(() => store.saved.length === 1);
          expect(store.saved).toEqual([wrap.created_at]);
        }),
    );
  });

  it("gives up holding the cursor for a relay that fails every attempt, and later walks it from where the open started", async () => {
    const fakeA = new FakeRelay();
    const fakeB = new FakeRelay();
    fakeB.down = true;
    const cursor = hoursAgo(72);
    const wrap = reactionWrap("👍");
    const store = recordingCursorStore(cursor);

    await runOpen(
      [
        [relayA, fakeA],
        [relayB, fakeB],
      ],
      { cursorStore: store.layer },
      ({ collected }) =>
        Effect.gen(function* () {
          yield* eventually(() => fakeA.subscriptions.length === 1);
          fakeA.emit(wrap);
          fakeA.eose();
          yield* eventually(() => collected.length === 1);
          yield* eventually(() => store.saved.length === 1);
          expect(fakeB.connectAttempts).toBeGreaterThanOrEqual(3);

          fakeB.down = false;
          yield* eventually(() => fakeB.subscriptions.length === 1);
          expect(fakeB.subscriptions[0]?.filters[0]?.since).toBe(
            cursor - NIP59_BACKDATE_MARGIN_SECONDS,
          );
        }),
    );
  });

  it("keeps a relay's unfinished walk holding the cursor across a reconnect", async () => {
    const fakeA = new FakeRelay();
    const wrap = reactionWrap("👍");
    const store = recordingCursorStore();
    let fetches = 0;
    const fetch: NostrTransportService["fetch"] = (relay) =>
      fetches++ === 0
        ? Effect.fail(new RelayUnreachable({ relay, detail: "reset" }))
        : Effect.succeed([]);

    await runOpen(
      [[relayA, fakeA]],
      { cursorStore: store.layer, backfill: { fetch } },
      ({ collected }) =>
        Effect.gen(function* () {
          yield* eventually(() => fakeA.subscriptions.length === 1);
          fakeA.eose();
          yield* eventually(() => fakeA.subscriptions.length === 2);
          fakeA.emit(wrap);
          yield* eventually(() => collected.length === 1);
          expect(store.saved).toEqual([]);

          fakeA.eose();
          yield* eventually(() => store.saved.length === 1);
          expect(store.saved).toEqual([wrap.created_at]);
        }),
    );
  });
});
