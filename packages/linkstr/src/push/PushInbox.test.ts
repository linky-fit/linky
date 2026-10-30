import { Duration, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { TestClock } from "effect/testing";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import type { Event as NostrToolsEvent, Filter } from "nostr-tools";
import { Pubkey, RelayUrl } from "../domain/primitives";
import {
  makeRelayPoolTransport,
  NostrTransport,
} from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import { eventually, FakeRelay, poolFor } from "../testing";
import type {
  DeliveredPushWrap,
  PushRelayStatusEvent,
  PushWrapFailure,
} from "./PushInbox";
import { PushInbox } from "./PushInbox";
import { watchPushInbox } from "./headless";

const STRICT_FILTER_CLOSE_REASON = "bad req: unindexed tag filter";

const hasMultiLetterTagFilter = (filters: ReadonlyArray<Filter>): boolean =>
  filters.some((filter) =>
    Object.keys(filter).some(
      (key) => key.startsWith("#") && key.slice(1).length !== 1,
    ),
  );

/** Refuses multi-letter tag filters like strfry does. */
const strictRelay = (): FakeRelay =>
  new FakeRelay({
    rejectFilters: (filters) =>
      hasMultiLetterTagFilter(filters) ? STRICT_FILTER_CLOSE_REASON : null,
  });

const secretKey = generateSecretKey();
const recipient = Pubkey.make(getPublicKey(generateSecretKey()));

const pushWrap = (content: string): NostrToolsEvent =>
  finalizeEvent(
    {
      kind: 1059,
      created_at: Math.floor(Date.now() / 1000),
      content,
      tags: [
        ["p", recipient, "wss://hint.test"],
        ["linky", "push"],
      ],
    },
    secretKey,
  );

/** Lets forked fibers and transport promises run without advancing the TestClock. */
const settle = Effect.gen(function* () {
  for (let round = 0; round < 20; round++) {
    yield* Effect.yieldNow;
    yield* Effect.promise(() => Promise.resolve());
  }
});

describe("PushInbox", () => {
  it("rejects multi-letter tag filters like a strict production relay", async () => {
    const relay = RelayUrl.make("wss://strict-relay.test");
    const fake = strictRelay();
    const pool = poolFor(new Map([[relay, fake]]));
    const transport = makeRelayPoolTransport(pool);
    let delivered = 0;

    const reason = await Effect.runPromise(
      transport.subscribe(
        relay,
        { "#linky": ["push"] },
        () => (delivered += 1),
      ),
    );
    fake.emit(pushWrap("rejected"));

    expect(reason).toBe(STRICT_FILTER_CLOSE_REASON);
    expect(fake.subscriptions[0]?.closed).toBe(true);
    expect(delivered).toBe(0);
  });

  it("validates, phases and dedupes only live push wraps across relays", async () => {
    const relayA = RelayUrl.make("wss://relay-a.test");
    const relayB = RelayUrl.make("wss://relay-b.test");
    const fakeA = new FakeRelay();
    const fakeB = new FakeRelay();
    const pool = poolFor(
      new Map([
        [relayA, fakeA],
        [relayB, fakeB],
      ]),
    );
    const layer = PushInbox.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          RelayPolicy.fixed({ readRelays: [relayA, relayB], writeRelays: [] }),
          Layer.succeed(NostrTransport, makeRelayPoolTransport(pool)),
        ),
      ),
    );

    await Effect.gen(function* () {
      const inbox = yield* PushInbox;
      const events = yield* inbox.open({
        recipients: Stream.make([recipient]),
        lookback: Duration.days(3),
        resubscribeDelay: Duration.millis(10),
      });
      const collected: Array<DeliveredPushWrap> = [];
      yield* Effect.forkScoped(
        Stream.runForEach(events, (event) =>
          Effect.sync(() => collected.push(event)),
        ),
      );
      yield* eventually(
        () =>
          fakeA.subscriptions.length === 1 && fakeB.subscriptions.length === 1,
      );

      const filter = fakeA.subscriptions[0]?.filters[0];
      const expectedSince =
        Math.floor(Date.now() / 1000) - Duration.toSeconds(Duration.days(3));
      expect(filter?.kinds).toEqual([1059]);
      expect(filter?.["#p"]).toEqual([recipient]);
      expect(filter?.limit).toBe(1);
      expect(filter?.since).toBeGreaterThanOrEqual(expectedSince - 2);
      expect(filter?.since).toBeLessThanOrEqual(expectedSince + 2);
      expect(
        Object.keys(filter ?? {}).filter(
          (key) => key.startsWith("#") && key.slice(1).length !== 1,
        ),
      ).toEqual([]);

      const historical = pushWrap("historical");
      fakeA.emit(historical);
      yield* eventually(() => collected.length === 1);
      fakeB.emit(historical);
      yield* eventually(() => collected.length === 2);
      expect(collected.map(({ delivery }) => delivery)).toEqual([
        "backfill",
        "backfill",
      ]);

      fakeB.eose();
      fakeB.emit(historical);
      yield* eventually(() => collected.length === 3);
      expect(collected[2]?.delivery).toBe("live");

      fakeA.eose();
      const duplicatedLive = pushWrap("duplicated live");
      fakeA.emit(duplicatedLive);
      fakeB.emit(duplicatedLive);
      yield* eventually(() => collected.length === 4);
      yield* Effect.sleep(Duration.millis(10));
      expect(collected).toHaveLength(4);
      expect(collected[3]?.wrap.wrapId).toBe(duplicatedLive.id);

      const live = pushWrap("live");
      fakeA.emit({ ...live, content: "tampered" });
      fakeB.emit(live);
      yield* eventually(() => collected.length === 5);
      expect(collected[4]).toEqual({
        delivery: "live",
        wrap: {
          wrapId: live.id,
          recipient,
          createdAt: live.created_at,
        },
      });
    }).pipe(Effect.scoped, Effect.provide(layer), Effect.runPromise);
  });

  it("opens no REQ without recipients and follows recipient changes", async () => {
    const relay = RelayUrl.make("wss://recipients-relay.test");
    const fake = new FakeRelay();
    const pool = poolFor(new Map([[relay, fake]]));
    const layer = PushInbox.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          RelayPolicy.fixed({ readRelays: [relay], writeRelays: [] }),
          Layer.succeed(NostrTransport, makeRelayPoolTransport(pool)),
        ),
      ),
    );
    const many = Array.from({ length: 251 }, () =>
      Pubkey.make(getPublicKey(generateSecretKey())),
    );
    const relayStatuses: Array<PushRelayStatusEvent> = [];

    await Effect.gen(function* () {
      const recipients = yield* SubscriptionRef.make<ReadonlyArray<Pubkey>>([]);
      const inbox = yield* PushInbox;
      const events = yield* inbox.open({
        recipients: SubscriptionRef.changes(recipients),
        lookback: Duration.days(3),
        resubscribeDelay: Duration.millis(10),
        onRelayStatus: (event) => relayStatuses.push(event),
      });
      yield* Effect.forkScoped(Stream.runDrain(events));
      yield* Effect.sleep(Duration.millis(20));
      expect(fake.subscriptions).toHaveLength(0);

      yield* SubscriptionRef.set(recipients, many);
      yield* eventually(() => fake.subscriptions.length === 2);
      expect(
        fake.subscriptions.map(({ filters }) => filters[0]?.["#p"]?.length),
      ).toEqual([250, 1]);
      expect(
        fake.subscriptions.flatMap(({ filters }) => filters[0]?.["#p"] ?? []),
      ).toEqual([...many].sort());

      fake.eose();
      yield* eventually(() => relayStatuses.length === 1);
      expect(relayStatuses).toEqual([{ type: "eose", relay }]);

      yield* SubscriptionRef.set(recipients, [...many].reverse());
      yield* Effect.sleep(Duration.millis(20));
      expect(fake.subscriptions).toHaveLength(2);

      yield* SubscriptionRef.set(recipients, [recipient]);
      yield* eventually(() => fake.subscriptions.length === 3);
      expect(fake.subscriptions.slice(0, 2).every(({ closed }) => closed)).toBe(
        true,
      );
      expect(fake.subscriptions[2]?.filters[0]?.["#p"]).toEqual([recipient]);

      yield* SubscriptionRef.set(recipients, []);
      yield* eventually(() => fake.subscriptions[2]?.closed === true);
      yield* Effect.sleep(Duration.millis(20));
      expect(fake.subscriptions).toHaveLength(3);
    }).pipe(Effect.scoped, Effect.provide(layer), Effect.runPromise);
  });

  it("filters a live cross-relay duplicate before transport delivery", async () => {
    const relayA = RelayUrl.make("wss://relay-a.test");
    const relayB = RelayUrl.make("wss://relay-b.test");
    const fakeA = new FakeRelay();
    const fakeB = new FakeRelay();
    const pool = poolFor(
      new Map([
        [relayA, fakeA],
        [relayB, fakeB],
      ]),
    );
    const layer = PushInbox.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          RelayPolicy.fixed({ readRelays: [relayA, relayB], writeRelays: [] }),
          Layer.succeed(NostrTransport, makeRelayPoolTransport(pool)),
        ),
      ),
    );

    await Effect.gen(function* () {
      const inbox = yield* PushInbox;
      const events = yield* inbox.open({
        recipients: Stream.make([recipient]),
        lookback: Duration.days(3),
        resubscribeDelay: Duration.millis(10),
      });
      const collected: Array<DeliveredPushWrap> = [];
      yield* Effect.forkScoped(
        Stream.runForEach(events, (event) =>
          Effect.sync(() => collected.push(event)),
        ),
      );
      yield* eventually(
        () =>
          fakeA.subscriptions.length === 1 && fakeB.subscriptions.length === 1,
      );
      fakeA.eose();
      fakeB.eose();

      const wrap = pushWrap("cross-relay duplicate");
      fakeA.emit(wrap);
      yield* eventually(() => collected.length === 1);
      fakeB.emit(wrap);
      yield* Effect.sleep(Duration.millis(10));

      expect(fakeB.alreadyHaveChecks).toContain(wrap.id);
      expect(collected).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(layer), Effect.runPromise);
  });

  it("refreshes a subscription that stays open", async () => {
    const relay = RelayUrl.make("wss://refresh-relay.test");
    const fake = strictRelay();
    const pool = poolFor(new Map([[relay, fake]]));
    const layer = PushInbox.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          RelayPolicy.fixed({ readRelays: [relay], writeRelays: [] }),
          Layer.succeed(NostrTransport, makeRelayPoolTransport(pool)),
        ),
      ),
    );
    const refreshInterval = Duration.minutes(1);

    await Effect.gen(function* () {
      // TestClock starts at epoch 0, which is not a valid UnixSeconds.
      yield* TestClock.setTime(1_754_000_000_000);
      const inbox = yield* PushInbox;
      const events = yield* inbox.open({
        recipients: Stream.make([recipient]),
        lookback: Duration.days(3),
        refreshInterval,
        resubscribeDelay: Duration.millis(10),
      });
      yield* Effect.forkScoped(Stream.runDrain(events));
      yield* settle;
      expect(fake.subscriptions).toHaveLength(1);

      yield* TestClock.adjust(refreshInterval);
      expect(fake.subscriptions[0]?.closed).toBe(true);
      yield* TestClock.adjust(Duration.millis(20));
      yield* settle;

      expect(fake.subscriptions).toHaveLength(2);
    }).pipe(
      Effect.scoped,
      Effect.provide(layer),
      Effect.provide(TestClock.layer()),
      Effect.runPromise,
    );
  });

  it("reports anomalous wraps and relay statuses", async () => {
    const relay = RelayUrl.make("wss://reporting-relay.test");
    const fake = strictRelay();
    const pool = poolFor(new Map([[relay, fake]]));
    const layer = PushInbox.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          RelayPolicy.fixed({ readRelays: [relay], writeRelays: [] }),
          Layer.succeed(NostrTransport, makeRelayPoolTransport(pool)),
        ),
      ),
    );
    const invalidWraps: Array<PushWrapFailure> = [];
    const relayStatuses: Array<PushRelayStatusEvent> = [];

    await Effect.gen(function* () {
      const inbox = yield* PushInbox;
      const events = yield* inbox.open({
        recipients: Stream.make([recipient]),
        lookback: Duration.days(3),
        resubscribeDelay: Duration.seconds(1),
        onInvalidWrap: (failure) => invalidWraps.push(failure),
        onRelayStatus: (event) => relayStatuses.push(event),
      });
      yield* Effect.forkScoped(Stream.runDrain(events));
      yield* eventually(() => fake.subscriptions.length === 1);

      const tampered = pushWrap("tampered");
      fake.emit({ ...tampered, content: "changed" });
      yield* eventually(() => invalidWraps.length === 1);
      expect(invalidWraps).toEqual(["invalid-signature"]);

      fake.emit({ ...pushWrap("unmarked"), tags: [] });
      yield* Effect.sleep(Duration.millis(10));
      expect(invalidWraps).toEqual(["invalid-signature"]);

      fake.eose();
      fake.eose();
      yield* eventually(() => relayStatuses.length === 1);
      expect(relayStatuses).toEqual([{ type: "eose", relay }]);

      fake.closeFromRelay("relay maintenance");
      yield* eventually(() => relayStatuses.length === 2);
      expect(relayStatuses).toEqual([
        { type: "eose", relay },
        {
          type: "attempt-ended",
          relay,
          reason: "relay maintenance",
        },
      ]);
    }).pipe(Effect.scoped, Effect.provide(layer), Effect.runPromise);
  });

  it("watchPushInbox resubscribes on setRecipients", async () => {
    const relay = RelayUrl.make("wss://headless-relay.test");
    const fake = new FakeRelay();
    const pool = poolFor(new Map([[relay, fake]]));
    const other = Pubkey.make(getPublicKey(generateSecretKey()));
    const subscription = watchPushInbox(
      {
        readRelays: [relay],
        recipients: [recipient],
        lookbackSeconds: 3 * 24 * 60 * 60,
        transport: Layer.succeed(NostrTransport, makeRelayPoolTransport(pool)),
      },
      () => {},
    );

    try {
      await Effect.runPromise(
        eventually(() => fake.subscriptions.length === 1),
      );
      subscription.setRecipients([recipient, other]);
      await Effect.runPromise(
        eventually(() => fake.subscriptions.length === 2),
      );

      expect(fake.subscriptions[0]?.closed).toBe(true);
      expect(fake.subscriptions[1]?.filters[0]?.["#p"]).toEqual(
        [recipient, other].sort(),
      );
    } finally {
      await subscription.close();
    }
  });
});
