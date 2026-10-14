import {
  CashuTokenText,
  ChatMessageReceived,
  ClientId,
  EnqueueReceipt,
  OutboxJobFailed,
  OutboxJobId,
  OutboxRef,
  OwnChatMessageConfirmed,
  RelayUrl,
  RumorId,
  TextBody,
  TokenBody,
  UnixSeconds,
  type MessageText,
  type Pubkey,
} from "@linky-fit/linkstr";
import {
  eventually,
  makeIdentity,
  recipientOf,
  stubWrapTransport,
  type SignedWrapEvent,
} from "@linky-fit/linkstr/testing";
import { DecodedToken, encodeToken } from "@linky-fit/linkshu";
import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { makeRepositories } from "../storage/repositories";
import { readSupportChat } from "../storage/supportChat";
import { createNostr } from "./nostr";
import { makeLinkstrRuntime, type LinkstrRuntime } from "./runtimes";
import { createSupportChat, supportPubkey } from "./supportChat";
import { fakeNostr, sharedOutboxStore, testStore } from "./testing/fakes";

const sentAt = UnixSeconds.make(1_760_000_000);
const rumor = (byte: string) => RumorId.make(byte.repeat(32));

const fromSupport = (
  text: string,
  overrides: Partial<{
    from: Pubkey;
    messageId: RumorId;
    sentAt: UnixSeconds;
  }> = {},
) =>
  new ChatMessageReceived({
    messageId: rumor("a1"),
    from: supportPubkey,
    body: new TextBody({ text }),
    replyTo: null,
    root: null,
    editOf: null,
    clientId: null,
    sentAt,
    ...overrides,
  });

const ownEcho = (text: string, messageId: RumorId, clientId: ClientId) =>
  new OwnChatMessageConfirmed({
    messageId,
    to: supportPubkey,
    body: new TextBody({ text }),
    replyTo: null,
    root: null,
    editOf: null,
    clientId,
    sentAt,
  });

const harness = (overrides: Parameters<typeof fakeNostr>[0] = {}) => {
  const store = testStore();
  const { conversations } = makeRepositories(store);
  const fake = fakeNostr(overrides);
  const chat = createSupportChat({
    conversations,
    nostr: fake.nostr,
    whenHydrated: () => Promise.resolve(),
  });
  const deliver = async (event: Parameters<(typeof fake.inbox)[number]>[0]) => {
    for (const handler of fake.inbox) await handler(event, "live");
  };
  // A second device reads the same synced store through its own repositories.
  const read = () =>
    Effect.runPromise(readSupportChat(makeRepositories(store).conversations));
  return { chat, fake, deliver, read };
};

/** A fake outbox that records what was queued and answers with the given rumor ids in turn. */
const recordingSend = (...rumorIds: RumorId[]) => {
  const sent: { to: Pubkey; text: MessageText; ref: string }[] = [];
  const sendText = (
    to: Pubkey,
    text: MessageText,
    clientId: ClientId,
    ref: string,
  ) => {
    sent.push({ to, text, ref });
    return Promise.resolve(
      new EnqueueReceipt({
        jobId: OutboxJobId.make("job-1"),
        ref: OutboxRef.make(ref),
        rumorId: rumorIds[sent.length - 1]!,
        clientId,
        sentAt,
      }),
    );
  };
  return { sent, sendText };
};

describe("the support chat", () => {
  it("keeps support's messages once, however often the inbox replays them", async () => {
    const { deliver, read } = harness();
    await deliver(fromSupport("Dobrý den, jak pomůžeme?"));
    await deliver(fromSupport("Dobrý den, jak pomůžeme?"));

    const chat = await read();
    expect(chat.messages).toMatchObject([
      { direction: "in", text: "Dobrý den, jak pomůžeme?", status: "sent" },
    ]);
    expect(chat.unread).toBe(true);
  });

  it("leaves other people's messages, tokens and edits to the rest of the app", async () => {
    const { deliver, read } = harness();
    await deliver(fromSupport("Ahoj", { from: makeIdentity().pubkey }));
    await deliver(
      new ChatMessageReceived({
        ...fromSupport("x"),
        body: new TokenBody({
          token: CashuTokenText.make(
            encodeToken(
              Schema.decodeUnknownSync(DecodedToken)({
                mint: "http://localhost:3338",
                unit: "sat",
                memo: null,
                proofs: [
                  {
                    id: "00ad268c4d1f5826",
                    amount: 21,
                    secret: "secret",
                    C: "02".padEnd(66, "a"),
                  },
                ],
              }),
            ),
          ),
        }),
      }),
    );
    await deliver(
      new ChatMessageReceived({
        ...fromSupport("Oprava"),
        editOf: rumor("a1"),
      }),
    );

    expect((await read()).messages).toEqual([]);
  });

  it("stores an own message to support sent from another device", async () => {
    const { deliver, read } = harness();
    await deliver(ownEcho("Z tabletu", rumor("b2"), ClientId.make("tablet")));

    expect((await read()).messages).toMatchObject([
      { direction: "out", text: "Z tabletu", status: "sent" },
    ]);
  });

  it("sends a text to support as pending and marks it sent by its outbox result or echo", async () => {
    const outbox = recordingSend(rumor("c3"));
    const { chat, fake, deliver, read } = harness({
      sendText: outbox.sendText,
    });

    await chat.send("  Nejde mi tisk účtenek  ");
    expect(outbox.sent).toEqual([
      {
        to: supportPubkey,
        text: "Nejde mi tisk účtenek",
        ref: expect.stringMatching(/^support:/u),
      },
    ]);
    expect((await read()).messages).toMatchObject([
      { direction: "out", text: "Nejde mi tisk účtenek", status: "pending" },
    ]);

    await deliver(
      ownEcho("Nejde mi tisk účtenek", rumor("c3"), ClientId.make("x")),
    );
    const chatAfterEcho = await read();
    expect(chatAfterEcho.messages).toMatchObject([{ status: "sent" }]);
    expect(chatAfterEcho.unread).toBe(false);
    expect(fake.outbox.map(({ refPrefix }) => refPrefix)).toEqual(["support:"]);
  });

  it("marks a message failed when the outbox gives it up", async () => {
    const outbox = recordingSend(rumor("d4"));
    const { chat, fake, read } = harness({ sendText: outbox.sendText });
    await chat.send("Pomoc");
    const ref = OutboxRef.make(outbox.sent[0]!.ref);

    for (const { handler } of fake.outbox) {
      await handler(
        new OutboxJobFailed({
          jobId: OutboxJobId.make("job-1"),
          ref,
          reason: "unexpected-error",
          detail: "boom",
        }),
      );
    }

    expect((await read()).messages).toMatchObject([{ status: "failed" }]);
  });

  it("rejects a send the outbox did not take and stores nothing", async () => {
    const { chat, read } = harness();
    await expect(chat.send("Ahoj")).rejects.toThrow();
    expect((await read()).messages).toEqual([]);
  });

  it("is read up to the newest message the merchant saw", async () => {
    const { chat, deliver, read } = harness();
    await deliver(fromSupport("Ozveme se"));
    await chat.markSeen(sentAt);
    expect((await read()).unread).toBe(false);

    await deliver(
      fromSupport("Hotovo", {
        messageId: rumor("e5"),
        sentAt: UnixSeconds.make(sentAt + 60),
      }),
    );
    expect((await read()).unread).toBe(true);
  });
});

describe("sending to support over Nostr", () => {
  let runtime: LinkstrRuntime | null = null;
  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("gift-wraps the text to the support key and to the merchant", async () => {
    const relays = [RelayUrl.make("wss://relay.test")];
    const published: SignedWrapEvent[] = [];
    const outboxStore = sharedOutboxStore();
    const merchant = makeIdentity();
    runtime = makeLinkstrRuntime({
      secretKey: merchant.secretKey,
      relays,
      allowInsecureLocalhostRelays: false,
      transport: stubWrapTransport(published),
      outboxStore,
    });
    const nostr = createNostr({
      runtime,
      pubkey: merchant.pubkey,
      relays,
      outboxStore,
    });
    const store = testStore();
    const chat = createSupportChat({
      conversations: makeRepositories(store).conversations,
      nostr,
      whenHydrated: () => Promise.resolve(),
    });

    await chat.send("Ahoj podporo");

    await Effect.runPromise(eventually(() => published.length === 2));
    expect(published.map((wrap) => wrap.kind)).toEqual([1059, 1059]);
    expect(new Set(published.map(recipientOf))).toEqual(
      new Set([supportPubkey, merchant.pubkey]),
    );
  });
});
