import { Effect, Fiber, Layer, Stream } from "effect";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import type { Event as NostrToolsEvent } from "nostr-tools";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";
import { nsecEncode } from "nostr-tools/nip19";
import {
  encodeImageMessageRumor,
  encodeTokenMessageRumor,
} from "../chat/codec";
import {
  CashuTokenText,
  ImageMessageDraft,
  MessageText,
  PrivateImage,
  TokenMessageDraft,
} from "../chat/domain";
import { linkstrServices } from "../composition";
import { ClientId, Pubkey, RelayUrl, UnixSeconds } from "../domain/primitives";
import { WrapInbox } from "../inbox/WrapInbox";
import { wrapRumorFor } from "../internal/giftWrap";
import { NostrConnectRequest } from "../nostrConnect/domain";
import { NostrConnect } from "../nostrConnect/NostrConnect";
import { OutboxRef } from "../outbox/domain";
import { Outbox } from "../outbox/Outbox";
import { observeTransport } from "../relayHealth/observeTransport";
import { RelayHealth } from "../relayHealth/RelayHealth";
import { NostrTransport, RelayPublishResult } from "../services/NostrTransport";
import type { NostrTransportService } from "../services/NostrTransport";
import { makeIdentity } from "../testing";
import type { InspectorEvent } from "./events";
import { Inspector } from "./Inspector";
import { inspectTransport } from "./inspectTransport";

const me = makeIdentity();
const sender = makeIdentity();
// Extra credential fields catch accidental emission of the consumer's config.
const identityConfig = {
  ...me,
  nsec: nsecEncode(me.secretKey),
  seedWords:
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
};

const expectNoIdentitySecrets = (
  events: ReadonlyArray<InspectorEvent>,
): void => {
  const secrets = [
    identityConfig.seedWords,
    ...[me, sender].flatMap(({ secretKey }) => [
      Buffer.from(secretKey).toString("hex"),
      nsecEncode(secretKey),
      JSON.stringify(secretKey),
      JSON.stringify(Array.from(secretKey)),
    ]),
  ];
  expect(events.length).toBeGreaterThan(0);
  for (const event of events) {
    const serialized = JSON.stringify(event);
    for (const secret of secrets) {
      expect(serialized, eventLabel(event)).not.toContain(secret);
    }
  }
};
const peer = Pubkey.make(getPublicKey(generateSecretKey()));
const relay = RelayUrl.make("wss://relay.test");

const eventLabel = (event: { _tag: string }): string =>
  "name" in event ? `${event._tag}:${String(event.name)}` : event._tag;

/**
 * Composes the runtime exactly like linkstr-react/src/runtime.ts and runs one
 * chat send through the outbox, returning every inspector event seen.
 */
const collectSendEmissions = (
  publish: NostrTransportService["publish"],
): Promise<InspectorEvent[]> => {
  const transport = Layer.succeed(NostrTransport, {
    publish,
    subscribe: () => Effect.never,
    fetch: () => Effect.succeed([]),
  });
  const layer = linkstrServices({
    ...identityConfig,
    readRelays: [relay],
    writeRelays: [relay],
    transport: inspectTransport(observeTransport(transport)),
  }).pipe(
    Layer.provideMerge(Inspector.live),
    Layer.provideMerge(RelayHealth.live),
  );

  const program = Effect.gen(function* () {
    const inspector = yield* Inspector;
    const collected: InspectorEvent[] = [];
    const consumer = yield* Stream.runForEach(inspector.events, (event) =>
      Effect.sync(() => {
        collected.push(event);
      }),
    ).pipe(Effect.fork);

    const outbox = yield* Outbox;
    yield* outbox.enqueue(
      {
        _tag: "chat.text",
        draft: { to: peer, content: MessageText.make("emission test") },
      },
      OutboxRef.make("emission-test-1"),
    );
    // The worker delivers asynchronously; poll until the terminal job event
    // lands instead of guessing a fixed delay.
    yield* Effect.iterate(0, {
      while: (tries) =>
        tries < 100 &&
        !collected.some((event) =>
          eventLabel(event).startsWith("PlainOperationSucceeded:outbox.job"),
        ) &&
        !collected.some((event) =>
          eventLabel(event).startsWith("OperationFailed:outbox.job"),
        ),
      body: (tries) => Effect.as(Effect.sleep("20 millis"), tries + 1),
    });
    yield* Fiber.interrupt(consumer);
    return collected;
  });

  return Effect.runPromise(Effect.scoped(Effect.provide(program, layer)));
};

const attachmentKey = "01".repeat(32);
const attachmentNonce = "02".repeat(12);
const image = new PrivateImage({
  url: "https://blossom.test/image",
  fileType: "image/jpeg",
  encryptionAlgorithm: "aes-gcm",
  key: attachmentKey,
  nonce: attachmentNonce,
  encryptedSha256: "03".repeat(32),
  originalSha256: "04".repeat(32),
  encryptedSize: 1234,
  width: 640,
  height: 480,
  storageEncoding: "base64",
});
const incomingImageWrap = wrapRumorFor(
  encodeImageMessageRumor(
    new ImageMessageDraft({ to: me.pubkey, image }),
    sender.pubkey,
    UnixSeconds.make(1_754_000_000),
    ClientId.make("incoming-image"),
  ),
  sender.secretKey,
  me.pubkey,
);

const collectImageEmissions = (): Promise<InspectorEvent[]> => {
  const transport = Layer.succeed(NostrTransport, {
    publish: (relays) =>
      Effect.succeed(
        relays.map(
          (relayUrl) =>
            new RelayPublishResult({
              relay: relayUrl,
              accepted: true,
              detail: null,
            }),
        ),
      ),
    subscribe: (_relay, filter, onEvent) =>
      Effect.sync(() => {
        if (filter.kinds?.includes(1059)) onEvent(incomingImageWrap);
      }).pipe(Effect.andThen(Effect.never)),
    fetch: () => Effect.succeed([incomingImageWrap]),
  });
  const layer = linkstrServices({
    ...identityConfig,
    readRelays: [relay],
    writeRelays: [relay],
    transport: inspectTransport(observeTransport(transport)),
  }).pipe(
    Layer.provideMerge(Inspector.live),
    Layer.provideMerge(RelayHealth.live),
  );

  const program = Effect.gen(function* () {
    const inspector = yield* Inspector;
    const collected: InspectorEvent[] = [];
    const consumer = yield* Stream.runForEach(inspector.events, (event) =>
      Effect.sync(() => {
        collected.push(event);
      }),
    ).pipe(Effect.fork);

    const outbox = yield* Outbox;
    yield* outbox.enqueue(
      { _tag: "chat.image", draft: new ImageMessageDraft({ to: peer, image }) },
      OutboxRef.make("emission-image-1"),
    );
    const inbox = yield* WrapInbox;
    const feed = yield* inbox.open({});
    yield* Stream.runHead(feed.events);
    yield* inbox.fetchWrapEvent(incomingImageWrap.id);
    yield* Effect.iterate(0, {
      while: (tries) =>
        tries < 100 &&
        !collected.some((event) => eventLabel(event).includes("outbox.job")),
      body: (tries) => Effect.as(Effect.sleep("20 millis"), tries + 1),
    });
    yield* Fiber.interrupt(consumer);
    return collected;
  });

  return Effect.runPromise(Effect.scoped(Effect.provide(program, layer)));
};

const cashuToken = `cashuA${Buffer.from(
  JSON.stringify({
    token: [
      { mint: "https://mint.test", proofs: [{ amount: 8, secret: "s" }] },
    ],
    unit: "sat",
  }),
)
  .toString("base64url")
  .replace(/=+$/g, "")}`;
const incomingTokenWrap = wrapRumorFor(
  encodeTokenMessageRumor(
    new TokenMessageDraft({
      to: me.pubkey,
      token: CashuTokenText.make(cashuToken),
    }),
    sender.pubkey,
    UnixSeconds.make(1_754_000_001),
    ClientId.make("incoming-token"),
  ),
  sender.secretKey,
  me.pubkey,
);

const collectTokenEmissions = (): Promise<InspectorEvent[]> => {
  const transport = Layer.succeed(NostrTransport, {
    publish: (relays) =>
      Effect.succeed(
        relays.map(
          (relayUrl) =>
            new RelayPublishResult({
              relay: relayUrl,
              accepted: true,
              detail: null,
            }),
        ),
      ),
    subscribe: (_relay, filter, onEvent) =>
      Effect.sync(() => {
        if (filter.kinds?.includes(1059)) onEvent(incomingTokenWrap);
      }).pipe(Effect.andThen(Effect.never)),
    fetch: () => Effect.succeed([incomingTokenWrap]),
  });
  const layer = linkstrServices({
    ...identityConfig,
    readRelays: [relay],
    writeRelays: [relay],
    transport: inspectTransport(observeTransport(transport)),
  }).pipe(
    Layer.provideMerge(Inspector.live),
    Layer.provideMerge(RelayHealth.live),
  );

  const program = Effect.gen(function* () {
    const inspector = yield* Inspector;
    const collected: InspectorEvent[] = [];
    const consumer = yield* Stream.runForEach(inspector.events, (event) =>
      Effect.sync(() => {
        collected.push(event);
      }),
    ).pipe(Effect.fork);

    const outbox = yield* Outbox;
    yield* outbox.enqueue(
      {
        _tag: "chat.token",
        draft: new TokenMessageDraft({
          to: peer,
          token: CashuTokenText.make(cashuToken),
        }),
      },
      OutboxRef.make("emission-token-1"),
    );
    const inbox = yield* WrapInbox;
    const feed = yield* inbox.open({});
    yield* Stream.runHead(feed.events);
    yield* inbox.fetchWrapEvent(incomingTokenWrap.id);
    yield* Effect.iterate(0, {
      while: (tries) =>
        tries < 100 &&
        !collected.some((event) => eventLabel(event).includes("outbox.job")),
      body: (tries) => Effect.as(Effect.sleep("20 millis"), tries + 1),
    });
    yield* Fiber.interrupt(consumer);
    return collected;
  });

  return Effect.runPromise(Effect.scoped(Effect.provide(program, layer)));
};

describe("inspector emission never carries cashu tokens", () => {
  it("redacts the token on every send, outbox, and inbox row", async () => {
    const collected = await collectTokenEmissions();
    expectNoIdentitySecrets(collected);
    const labels = collected.map(eventLabel);

    expect(labels).toContain("OperationSucceeded:chat.sendToken");
    expect(labels).toContain("InboxRouted");

    for (const event of collected) {
      const serialized = JSON.stringify(event);
      expect(serialized, eventLabel(event)).not.toContain(cashuToken);
    }
  });
});

describe("inspector emission never carries attachment keys", () => {
  it("redacts image key and nonce on every send, outbox, and inbox row", async () => {
    const collected = await collectImageEmissions();
    expectNoIdentitySecrets(collected);
    const labels = collected.map(eventLabel);

    expect(labels).toContain("PlainOperationSucceeded:outbox.enqueue");
    expect(labels).toContain("OperationSucceeded:chat.sendImage");
    expect(labels).toContain("PlainOperationSucceeded:outbox.job");
    expect(labels).toContain("InboxRouted");
    expect(labels).toContain("PlainOperationSucceeded:inbox.fetchWrapEvent");

    const mentioningImage = collected.filter((event) =>
      JSON.stringify(event).includes(image.url),
    );
    expect(mentioningImage.map(eventLabel)).toEqual(
      expect.arrayContaining([
        "PlainOperationSucceeded:outbox.enqueue",
        "OperationSucceeded:chat.sendImage",
        "InboxRouted",
        "PlainOperationSucceeded:inbox.fetchWrapEvent",
      ]),
    );
    for (const event of collected) {
      const serialized = JSON.stringify(event);
      expect(serialized, eventLabel(event)).not.toContain(attachmentKey);
      expect(serialized, eventLabel(event)).not.toContain(attachmentNonce);
    }
  });
});

describe("inspector emission through the outbox send path", () => {
  it("emits enqueue, operation, wire publishes, and job settle for a chat send", async () => {
    const collected = await collectSendEmissions((relays) =>
      Effect.succeed(
        relays.map(
          (relayUrl) =>
            new RelayPublishResult({
              relay: relayUrl,
              accepted: true,
              detail: null,
            }),
        ),
      ),
    );

    expectNoIdentitySecrets(collected);
    const labels = collected.map(eventLabel);
    expect(labels).toContain("PlainOperationSucceeded:outbox.enqueue");
    expect(labels).toContain("OperationSucceeded:chat.sendText");
    expect(labels).toContain("PlainOperationSucceeded:outbox.job");
    expect(labels.filter((label) => label === "WirePublished")).toHaveLength(2);
  });

  it("still emits and still delivers when the transport returns off-schema results", async () => {
    // Regression: a throwing event constructor used to swallow the emission
    // AND fail the delivery as a defect. Plain objects instead of
    // RelayPublishResult instances reproduce that exact condition.
    const collected = await collectSendEmissions((relays) =>
      Effect.succeed(
        relays.map((relayUrl) => ({
          relay: relayUrl,
          accepted: true,
          detail: null,
        })),
      ),
    );

    expectNoIdentitySecrets(collected);
    const labels = collected.map(eventLabel);
    expect(labels).toContain("PlainOperationSucceeded:outbox.job");
    expect(labels).toContain("OperationSucceeded:chat.sendText");
    expect(labels.filter((label) => label === "WirePublished")).toHaveLength(2);
  });
});

const loginSecret = "nostr-connect-login-secret";

const collectNostrConnectEmissions = (): Promise<InspectorEvent[]> => {
  const site = makeIdentity();
  const siteKey = getConversationKey(site.secretKey, me.pubkey);
  const listeners: Array<(event: NostrToolsEvent) => void> = [];
  const signRequest = finalizeEvent(
    {
      kind: 24133,
      tags: [["p", me.pubkey]],
      content: encrypt(
        JSON.stringify({
          id: "sign",
          method: "sign_event",
          params: [
            JSON.stringify({
              kind: 27235,
              content: "",
              tags: [["u", "https://site.test/login"]],
            }),
          ],
        }),
        siteKey,
      ),
      created_at: Math.floor(Date.now() / 1000),
    },
    site.secretKey,
  );
  const transport = Layer.succeed(NostrTransport, {
    publish: (relays, event) =>
      Effect.sync(() => {
        const reply = decrypt(event.content, siteKey);
        if (reply.includes(loginSecret)) {
          for (const listener of listeners) listener(signRequest);
        }
        return relays.map(
          (relayUrl) =>
            new RelayPublishResult({
              relay: relayUrl,
              accepted: true,
              detail: null,
            }),
        );
      }),
    subscribe: (_relay, _filter, onEvent, options) =>
      Effect.sync(() => {
        listeners.push(onEvent);
        options?.onEose?.();
      }).pipe(Effect.andThen(Effect.never)),
    fetch: () => Effect.succeed([]),
  });
  const layer = linkstrServices({
    ...identityConfig,
    readRelays: [relay],
    writeRelays: [relay],
    transport: inspectTransport(observeTransport(transport)),
  }).pipe(
    Layer.provideMerge(Inspector.live),
    Layer.provideMerge(RelayHealth.live),
  );

  const program = Effect.gen(function* () {
    const inspector = yield* Inspector;
    const collected: InspectorEvent[] = [];
    const consumer = yield* Stream.runForEach(inspector.events, (event) =>
      Effect.sync(() => {
        collected.push(event);
      }),
    ).pipe(Effect.fork);
    const connect = yield* NostrConnect;
    yield* connect.login(
      new NostrConnectRequest({
        clientPubkey: site.pubkey,
        relays: [relay],
        secret: loginSecret,
        perms: [],
        name: null,
        url: "https://site.test",
        image: null,
      }),
    );
    yield* Effect.sleep("20 millis");
    yield* Fiber.interrupt(consumer);
    return collected;
  });

  return Effect.runPromise(Effect.scoped(Effect.provide(program, layer)));
};

describe("inspector emission never carries the nostr connect secret", () => {
  it("keeps the login secret out of operation and wire rows", async () => {
    const collected = await collectNostrConnectEmissions();
    expectNoIdentitySecrets(collected);
    const labels = collected.map(eventLabel);
    expect(labels).toContain("PlainOperationSucceeded:nostrConnect.login");
    expect(
      labels.filter((label) => label === "WirePlainPublished"),
    ).toHaveLength(2);
    for (const event of collected) {
      expect(JSON.stringify(event), eventLabel(event)).not.toContain(
        loginSecret,
      );
    }
  });
});
