import { Effect, Either, Exit, Layer } from "effect";
import { ClientId, RelayUrl, RumorId, UnixSeconds } from "../domain/primitives";
import { unwrapToRumor } from "../internal/giftWrap";
import type { SignedWrapEvent } from "../internal/nostrEvent";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import type { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import {
  hasPushMarker,
  makeIdentity,
  recipientOf,
  stubWrapTransport,
} from "../testing";
import { Chat } from "./Chat";
import {
  CashuTokenText,
  EditMessageDraft,
  ImageMessageDraft,
  MessageText,
  PrivateImage,
  TextMessageDraft,
  TokenMessageDraft,
} from "./domain";

const alice = makeIdentity();
const bob = makeIdentity();
const relayA = RelayUrl.make("wss://relay-a.test");
const relayB = RelayUrl.make("wss://relay-b.test");
const clientId = ClientId.make("client-42");
const cashuToken = CashuTokenText.make(
  `cashuA${Buffer.from(
    JSON.stringify({
      token: [{ mint: "https://mint.test", proofs: [{ amount: 8 }] }],
      unit: "sat",
    }),
  ).toString("base64url")}`,
);

const image = new PrivateImage({
  url: "https://blossom.test/image",
  fileType: "image/jpeg",
  encryptionAlgorithm: "aes-gcm",
  key: "01".repeat(32),
  nonce: "02".repeat(12),
  encryptedSha256: "03".repeat(32),
  originalSha256: "04".repeat(32),
  encryptedSize: 1234,
  width: 640,
  height: 480,
  storageEncoding: "base64",
});

const runWith = <A, E>(
  transport: Layer.Layer<NostrTransport>,
  program: Effect.Effect<A, E, Chat>,
): Promise<Exit.Exit<A, E>> => {
  const dependencies = Layer.mergeAll(
    LinkstrIdentity.fromSecretKey(alice.secretKey),
    RelayPolicy.fixed({
      readRelays: [relayA, relayB],
      writeRelays: [relayA, relayB],
    }),
    transport,
  );
  return Effect.runPromiseExit(
    program.pipe(
      Effect.provide(Chat.Default.pipe(Layer.provide(dependencies))),
    ),
  );
};

describe("Chat sends", () => {
  it.each([
    {
      name: "text",
      run: (chat: Chat) =>
        chat.sendText(
          new TextMessageDraft({
            to: bob.pubkey,
            content: MessageText.make("hello"),
            clientId,
          }),
        ),
      kind: 14,
    },
    {
      name: "image",
      run: (chat: Chat) =>
        chat.sendImage(
          new ImageMessageDraft({ to: bob.pubkey, image, clientId }),
        ),
      kind: 15,
    },
  ])(
    "publishes readable $name wraps with only the recipient push-marked",
    async ({ run, kind }) => {
      const published: Array<SignedWrapEvent> = [];
      const exit = await runWith(
        stubWrapTransport(published),
        Effect.gen(function* () {
          const chat = yield* Chat;
          return yield* run(chat);
        }),
      );

      assert(Exit.isSuccess(exit));
      expect(exit.value.clientId).toBe(clientId);
      expect(exit.value.selfCopy.acceptedBy).toEqual([relayA, relayB]);
      expect(exit.value.recipientCopy.acceptedBy).toEqual([relayA, relayB]);
      expect(published).toHaveLength(2);

      const self = published.find((wrap) => recipientOf(wrap) === alice.pubkey);
      const recipient = published.find(
        (wrap) => recipientOf(wrap) === bob.pubkey,
      );
      assert(self !== undefined && recipient !== undefined);
      expect(hasPushMarker(self)).toBe(false);
      expect(hasPushMarker(recipient)).toBe(true);
      expect(recipient.created_at).toBeLessThanOrEqual(
        Math.ceil(Date.now() / 1000),
      );
      const rumor = Either.getOrThrow(unwrapToRumor(recipient, bob.secretKey));
      expect(rumor.id).toBe(exit.value.rumorId);
      expect(rumor.kind).toBe(kind);
    },
  );

  it("publishes unmarked edit wraps and returns the edit reference", async () => {
    const published: Array<SignedWrapEvent> = [];
    const editOf = RumorId.make("ab".repeat(32));
    const exit = await runWith(
      stubWrapTransport(published),
      Effect.gen(function* () {
        const chat = yield* Chat;
        return yield* chat.edit(
          new EditMessageDraft({
            to: bob.pubkey,
            editOf,
            content: MessageText.make("edited"),
            clientId,
          }),
        );
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.editOf).toBe(editOf);
    expect(published).toHaveLength(2);
    expect(published.every((wrap) => !hasPushMarker(wrap))).toBe(true);
  });

  it("publishes two unmarked token wraps with the token rumor", async () => {
    const published: Array<SignedWrapEvent> = [];
    const exit = await runWith(
      stubWrapTransport(published),
      Effect.gen(function* () {
        const chat = yield* Chat;
        return yield* chat.sendToken(
          new TokenMessageDraft({
            to: bob.pubkey,
            token: cashuToken,
            clientId,
          }),
        );
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.clientId).toBe(clientId);
    expect(exit.value.selfCopy.acceptedBy).toEqual([relayA, relayB]);
    expect(exit.value.recipientCopy.acceptedBy).toEqual([relayA, relayB]);
    expect(published).toHaveLength(2);
    expect(published.every((wrap) => !hasPushMarker(wrap))).toBe(true);

    for (const wrap of published) {
      const key =
        recipientOf(wrap) === alice.pubkey ? alice.secretKey : bob.secretKey;
      const rumor = Either.getOrThrow(unwrapToRumor(wrap, key));
      expect(rumor.id).toBe(exit.value.rumorId);
      expect(rumor.kind).toBe(14);
      expect(rumor.content).toBe(cashuToken);
    }
  });

  it("honors the draft sentAt override", async () => {
    const published: Array<SignedWrapEvent> = [];
    const sentAt = UnixSeconds.make(1_699_999_999);
    const exit = await runWith(
      stubWrapTransport(published),
      Effect.gen(function* () {
        const chat = yield* Chat;
        return yield* chat.sendText(
          new TextMessageDraft({
            to: bob.pubkey,
            content: MessageText.make("hello"),
            clientId,
            sentAt,
          }),
        );
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.sentAt).toBe(sentAt);
    const recipient = published.find(
      (wrap) => recipientOf(wrap) === bob.pubkey,
    );
    assert(recipient !== undefined);
    const rumor = Either.getOrThrow(unwrapToRumor(recipient, bob.secretKey));
    expect(rumor.created_at).toBe(sentAt);
    expect(rumor.id).toBe(exit.value.rumorId);
  });

  it.each([
    {
      name: "RecipientNotReached",
      accept: (wrap: SignedWrapEvent) => recipientOf(wrap) === alice.pubkey,
    },
    { name: "NoRelayReachable", accept: () => false },
  ])("maps token delivery failure to $name", async ({ name, accept }) => {
    const exit = await runWith(
      stubWrapTransport([], accept),
      Effect.gen(function* () {
        const chat = yield* Chat;
        return yield* chat.sendToken(
          new TokenMessageDraft({
            to: bob.pubkey,
            token: cashuToken,
            clientId,
          }),
        );
      }),
    );

    expect(exit).toEqual(
      Exit.fail(expect.objectContaining({ _tag: name, clientId })),
    );
  });
});
