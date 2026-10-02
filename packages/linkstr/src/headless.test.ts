import { Effect, Layer, Stream } from "effect";
import { getEventHash } from "nostr-tools";
import type { Event as NostrToolsEvent } from "nostr-tools";
import { RelayUrl, UnixSeconds } from "./domain/primitives";
import { runLinkstr } from "./headless";
import { InboxCursorStore } from "./inbox/InboxCursorStore";
import { NIP59_BACKDATE_MARGIN_SECONDS, WrapInbox } from "./inbox/WrapInbox";
import { wrapRumorFor } from "./internal/giftWrap";
import { Rumor } from "./internal/nostrEvent";
import type { NostrTags } from "./internal/nostrEvent";
import {
  makeRelayPoolTransport,
  NostrTransport,
} from "./services/NostrTransport";
import type { NostrTransportService } from "./services/NostrTransport";
import { RelayPolicy } from "./services/RelayPolicy";
import {
  eventually,
  FakeRelay,
  makeIdentity,
  poolFor,
  stubStorage,
} from "./testing";

const alice = makeIdentity();
const bob = makeIdentity();

const relayA = RelayUrl.make("wss://relay-a.test");
const relayB = RelayUrl.make("wss://relay-b.test");

const chatWrap = () => {
  const fields = {
    pubkey: bob.pubkey,
    created_at: UnixSeconds.make(1_754_000_000),
    kind: 14,
    tags: [["p", alice.pubkey]] satisfies NostrTags,
    content: "hello",
  };
  const rumor = new Rumor({ ...fields, id: getEventHash(fields) });
  return wrapRumorFor(rumor, bob.secretKey, alice.pubkey);
};

const transportOf = (
  stored: ReadonlyMap<RelayUrl, ReadonlyArray<NostrToolsEvent>>,
): NostrTransportService => ({
  publish: () => Effect.succeed([]),
  subscribe: () => Effect.never,
  fetch: (relay) => Effect.succeed(stored.get(relay) ?? []),
});

const scopedTransportOf = (
  service: NostrTransportService,
  lifecycle: Array<string>,
): Layer.Layer<NostrTransport> =>
  Layer.scoped(
    NostrTransport,
    Effect.acquireRelease(
      Effect.sync(() => {
        lifecycle.push("open");
        return service;
      }),
      () => Effect.sync(() => lifecycle.push("close")),
    ),
  );

describe("runLinkstr", () => {
  it("fetches a wrap through WrapInbox with a read-only relay policy", async () => {
    const wrap = chatWrap();

    const event = await runLinkstr(
      {
        secretKey: alice.secretKey,
        readRelays: [relayA],
        transport: Layer.succeed(
          NostrTransport,
          transportOf(new Map([[relayA, [wrap]]])),
        ),
      },
      Effect.flatMap(WrapInbox, (inbox) =>
        inbox.fetchWrapEvent(wrap.id, { extraRelays: [relayB] }),
      ),
    );

    expect(event).toEqual(
      expect.objectContaining({
        _tag: "ChatMessageReceived",
        from: bob.pubkey,
        body: expect.objectContaining({ _tag: "TextBody", text: "hello" }),
      }),
    );
  });

  it("defaults writeRelays to empty without failing eagerly", async () => {
    const writeRelays = await runLinkstr(
      {
        secretKey: alice.secretKey,
        readRelays: [relayA],
        transport: Layer.succeed(NostrTransport, transportOf(new Map())),
      },
      Effect.map(RelayPolicy, (policy) => policy.writeRelays),
    );

    expect(writeRelays).toEqual([]);
  });

  it("opens the scoped transport per run and closes it when the run ends", async () => {
    const lifecycle: Array<string> = [];
    const config = {
      secretKey: alice.secretKey,
      readRelays: [relayA],
      transport: scopedTransportOf(transportOf(new Map()), lifecycle),
    };
    const probe = Effect.as(WrapInbox, "done");

    await expect(runLinkstr(config, probe)).resolves.toBe("done");
    expect(lifecycle).toEqual(["open", "close"]);

    await runLinkstr(config, probe);
    expect(lifecycle).toEqual(["open", "close", "open", "close"]);
  });

  it("checkpoints a received wrap and resumes the next run from the supplied store", async () => {
    const storage = stubStorage();
    const fake = new FakeRelay();
    const wrap = chatWrap();
    const since = UnixSeconds.make(wrap.created_at - 3600);
    const config = {
      secretKey: alice.secretKey,
      readRelays: [relayA],
      inboxCursorStore: InboxCursorStore.fromStringStorage(storage, "cursor"),
      transport: Layer.succeed(
        NostrTransport,
        makeRelayPoolTransport(poolFor(new Map([[relayA, fake]]))),
      ),
    };

    const received = await runLinkstr(
      config,
      Effect.scoped(
        Effect.gen(function* () {
          const inbox = yield* WrapInbox;
          const feed = yield* inbox.open({ since });
          yield* eventually(() => fake.subscriptions.length === 1);
          fake.eose();
          yield* eventually(() => fake.subscriptions.length === 2);
          fake.eose();
          fake.emit(wrap);
          return yield* Stream.runCollect(
            Stream.take(
              Stream.tap(feed.events, ({ ack }) => ack),
              1,
            ),
          );
        }),
      ),
    );

    expect(Array.from(received)[0]?.event._tag).toBe("ChatMessageReceived");
    expect(storage.getItem("cursor")).toBe(String(wrap.created_at));
    expect(fake.subscriptions[0]?.filters[0]?.since).toBe(
      since - NIP59_BACKDATE_MARGIN_SECONDS,
    );
    expect(fake.subscriptions[0]?.closed).toBe(true);

    await runLinkstr(
      config,
      Effect.scoped(
        Effect.gen(function* () {
          const inbox = yield* WrapInbox;
          yield* inbox.open({ since });
          yield* eventually(() => fake.subscriptions.length === 3);
        }),
      ),
    );

    expect(fake.subscriptions[2]?.filters[0]?.since).toBe(
      wrap.created_at - NIP59_BACKDATE_MARGIN_SECONDS,
    );
    expect(fake.subscriptions[2]?.closed).toBe(true);
  });

  it("rejects with the effect's typed failure", async () => {
    const wrap = chatWrap();

    const error = await runLinkstr(
      {
        secretKey: alice.secretKey,
        readRelays: [],
        transport: Layer.succeed(NostrTransport, transportOf(new Map())),
      },
      Effect.flatMap(WrapInbox, (inbox) => inbox.fetchWrapEvent(wrap.id)),
    ).then(
      () => null,
      (rejection: unknown) => rejection,
    );

    expect(String(error)).toContain("NoReadRelaysConfigured");
  });
});
