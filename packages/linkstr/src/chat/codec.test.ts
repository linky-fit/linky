import { Either } from "effect";
import { getEventHash } from "nostr-tools";
import { encrypt, getConversationKey } from "nostr-tools/nip44";
import { ClientId, Pubkey, RumorId, UnixSeconds } from "../domain/primitives";
import { Rumor } from "../internal/nostrEvent";
import type { NostrTags } from "../internal/nostrEvent";
import {
  decodeChatRumor,
  encodeEditRumor,
  encodeImageMessageRumor,
  encodeTextMessageRumor,
  encodeTokenMessageRumor,
} from "./codec";
import {
  CashuTokenText,
  EditMessageDraft,
  ImageMessageDraft,
  MessageText,
  PrivateImage,
  TextMessageDraft,
  TokenMessageDraft,
} from "./domain";
import { makeIdentity } from "../testing";

const alice = makeIdentity();
const bob = makeIdentity();
const wrapAuthor = makeIdentity();
const sentAt = UnixSeconds.make(1_754_000_000);
const clientId = ClientId.make("client-1");
const rootId = RumorId.make("ab".repeat(32));
const replyId = RumorId.make("cd".repeat(32));
const editId = RumorId.make("ef".repeat(32));
const cashuToken = `cashuA${Buffer.from(
  JSON.stringify({
    token: [{ mint: "https://mint.test", proofs: [{ amount: 8 }] }],
    unit: "sat",
  }),
)
  .toString("base64url")
  .replace(/=+$/g, "")}`;

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

const withHash = (fields: {
  readonly pubkey: Pubkey;
  readonly created_at: UnixSeconds;
  readonly kind: number;
  readonly tags: NostrTags;
  readonly content: string;
}): Rumor => new Rumor({ ...fields, id: getEventHash(fields) });

describe("chat rumor encoding", () => {
  it("encodes text tags without a reply in exact order", () => {
    const rumor = encodeTextMessageRumor(
      new TextMessageDraft({
        to: bob.pubkey,
        content: MessageText.make("hello"),
      }),
      alice.pubkey,
      sentAt,
      clientId,
    );

    expect(rumor).toEqual(
      expect.objectContaining({
        kind: 14,
        content: "hello",
        tags: [
          ["p", bob.pubkey],
          ["p", alice.pubkey],
          ["client", clientId],
        ],
      }),
    );
    expect(rumor.id).toBe(getEventHash(rumor));
  });

  it("encodes marked reply tags and falls root back to replyTo", () => {
    const explicitRoot = encodeTextMessageRumor(
      new TextMessageDraft({
        to: bob.pubkey,
        content: MessageText.make("reply"),
        replyTo: replyId,
        root: rootId,
      }),
      alice.pubkey,
      sentAt,
      clientId,
    );
    const fallbackRoot = encodeTextMessageRumor(
      new TextMessageDraft({
        to: bob.pubkey,
        content: MessageText.make("reply"),
        replyTo: replyId,
      }),
      alice.pubkey,
      sentAt,
      clientId,
    );

    expect(explicitRoot.tags.slice(3)).toEqual([
      ["e", rootId, "", "root"],
      ["e", replyId, "", "reply"],
    ]);
    expect(fallbackRoot.tags.slice(3)).toEqual([
      ["e", replyId, "", "root"],
      ["e", replyId, "", "reply"],
    ]);
  });

  it("encodes token content and tags with and without reply context", () => {
    const bare = encodeTokenMessageRumor(
      new TokenMessageDraft({
        to: bob.pubkey,
        token: CashuTokenText.make(cashuToken),
      }),
      alice.pubkey,
      sentAt,
      clientId,
    );
    const reply = encodeTokenMessageRumor(
      new TokenMessageDraft({
        to: bob.pubkey,
        token: CashuTokenText.make(cashuToken),
        replyTo: replyId,
        root: rootId,
      }),
      alice.pubkey,
      sentAt,
      clientId,
    );

    expect(bare.content).toBe(cashuToken);
    expect(bare.tags).toEqual([
      ["p", bob.pubkey],
      ["p", alice.pubkey],
      ["client", clientId],
    ]);
    expect(reply.content).toBe(cashuToken);
    expect(reply.tags).toEqual([
      ["p", bob.pubkey],
      ["p", alice.pubkey],
      ["client", clientId],
      ["e", rootId, "", "root"],
      ["e", replyId, "", "reply"],
    ]);
  });

  it("encodes image metadata in legacy order and omits encoding for raw", () => {
    const base64Rumor = encodeImageMessageRumor(
      new ImageMessageDraft({ to: bob.pubkey, image }),
      alice.pubkey,
      sentAt,
      clientId,
    );
    const rawRumor = encodeImageMessageRumor(
      new ImageMessageDraft({
        to: bob.pubkey,
        image: new PrivateImage({ ...image, storageEncoding: "raw" }),
      }),
      alice.pubkey,
      sentAt,
      clientId,
    );

    expect(base64Rumor.tags).toEqual([
      ["p", bob.pubkey],
      ["p", alice.pubkey],
      ["client", clientId],
      ["file-type", "image/jpeg"],
      ["encryption-algorithm", "aes-gcm"],
      ["decryption-key", image.key],
      ["decryption-nonce", image.nonce],
      ["x", image.encryptedSha256],
      ["ox", image.originalSha256],
      ["size", "1234"],
      ["dim", "640x480"],
      ["encoding", "base64"],
    ]);
    expect(base64Rumor.content).toBe(image.url);
    expect(base64Rumor.id).toBe(getEventHash(base64Rumor));
    expect(rawRumor.tags).not.toContainEqual(["encoding", "base64"]);
  });

  it("rejects a lone dimension on the domain model", () => {
    expect(
      () =>
        new PrivateImage({
          url: image.url,
          fileType: image.fileType,
          encryptionAlgorithm: image.encryptionAlgorithm,
          key: image.key,
          nonce: image.nonce,
          encryptedSha256: image.encryptedSha256,
          originalSha256: image.originalSha256,
          encryptedSize: image.encryptedSize,
          width: 640,
          storageEncoding: image.storageEncoding,
        }),
    ).toThrow();
  });

  it("omits dim for files without dimensions and carries their name", () => {
    const pdf = new PrivateImage({
      url: image.url,
      fileType: "application/pdf",
      encryptionAlgorithm: "aes-gcm",
      key: image.key,
      nonce: image.nonce,
      encryptedSha256: image.encryptedSha256,
      originalSha256: image.originalSha256,
      encryptedSize: 1234,
      fileName: "invoice.pdf",
      storageEncoding: "base64",
    });
    const rumor = encodeImageMessageRumor(
      new ImageMessageDraft({ to: bob.pubkey, image: pdf }),
      alice.pubkey,
      sentAt,
      clientId,
    );

    expect(rumor.tags).not.toContainEqual(["dim", expect.anything()]);
    expect(rumor.tags).toContainEqual(["name", "invoice.pdf"]);
    expect(decodeChatRumor(rumor, bob, wrapAuthor.pubkey)).toEqual(
      Either.right(
        expect.objectContaining({
          body: expect.objectContaining({ _tag: "ImageBody", image: pdf }),
        }),
      ),
    );
  });

  it("encodes edits without reply tags", () => {
    const rumor = encodeEditRumor(
      new EditMessageDraft({
        to: bob.pubkey,
        editOf: editId,
        content: MessageText.make("edited"),
      }),
      alice.pubkey,
      sentAt,
      clientId,
    );

    expect(rumor.tags).toEqual([
      ["p", bob.pubkey],
      ["p", alice.pubkey],
      ["edited_from", editId],
      ["client", clientId],
    ]);
    expect(rumor.content).toBe("edited");
    expect(rumor.id).toBe(getEventHash(rumor));
  });
});

describe("chat rumor decoding", () => {
  it("decodes an own text echo with its peer and clientId", () => {
    const rumor = encodeTextMessageRumor(
      new TextMessageDraft({
        to: bob.pubkey,
        content: MessageText.make("hello"),
      }),
      alice.pubkey,
      sentAt,
      clientId,
    );

    expect(decodeChatRumor(rumor, alice, wrapAuthor.pubkey)).toEqual(
      Either.right(
        expect.objectContaining({
          _tag: "OwnChatMessageConfirmed",
          messageId: rumor.id,
          to: bob.pubkey,
          body: expect.objectContaining({ _tag: "TextBody", text: "hello" }),
          clientId,
          replyTo: null,
          root: null,
          editOf: null,
          sentAt,
        }),
      ),
    );
  });

  it("decodes an addressed incoming text from the rumor author", () => {
    const rumor = encodeTextMessageRumor(
      new TextMessageDraft({
        to: alice.pubkey,
        content: MessageText.make("incoming"),
      }),
      bob.pubkey,
      sentAt,
      clientId,
    );

    expect(decodeChatRumor(rumor, alice, wrapAuthor.pubkey)).toEqual(
      Either.right(
        expect.objectContaining({
          _tag: "ChatMessageReceived",
          from: bob.pubkey,
          body: expect.objectContaining({ text: "incoming" }),
        }),
      ),
    );
  });

  it("roundtrips a private image", () => {
    const rumor = encodeImageMessageRumor(
      new ImageMessageDraft({ to: alice.pubkey, image }),
      bob.pubkey,
      sentAt,
      clientId,
    );
    const decoded = decodeChatRumor(rumor, alice, wrapAuthor.pubkey);

    expect(decoded).toEqual(
      Either.right(
        expect.objectContaining({
          body: expect.objectContaining({ _tag: "ImageBody", image }),
        }),
      ),
    );
  });

  it.each([
    { name: "bare token", content: cashuToken },
    { name: "cashu URI", content: `cashu:${cashuToken}` },
  ])("classifies a $name as TokenBody", ({ content }) => {
    const rumor = withHash({
      pubkey: bob.pubkey,
      created_at: sentAt,
      kind: 14,
      tags: [["p", alice.pubkey]],
      content,
    });

    expect(decodeChatRumor(rumor, alice, wrapAuthor.pubkey)).toEqual(
      Either.right(
        expect.objectContaining({
          body: expect.objectContaining({
            _tag: "TokenBody",
            token: cashuToken,
          }),
        }),
      ),
    );
  });

  it("keeps an embedded token as TextBody", () => {
    const content = `here is ${cashuToken} thanks`;
    const rumor = withHash({
      pubkey: bob.pubkey,
      created_at: sentAt,
      kind: 14,
      tags: [["p", alice.pubkey]],
      content,
    });

    expect(decodeChatRumor(rumor, alice, wrapAuthor.pubkey)).toEqual(
      Either.right(
        expect.objectContaining({
          body: expect.objectContaining({ _tag: "TextBody", text: content }),
        }),
      ),
    );
  });

  it("classifies token edit content and preserves editOf", () => {
    const rumor = encodeEditRumor(
      new EditMessageDraft({
        to: alice.pubkey,
        editOf: editId,
        content: MessageText.make(cashuToken),
      }),
      bob.pubkey,
      sentAt,
      clientId,
    );

    expect(decodeChatRumor(rumor, alice, wrapAuthor.pubkey)).toEqual(
      Either.right(
        expect.objectContaining({
          editOf: editId,
          body: expect.objectContaining({
            _tag: "TokenBody",
            token: cashuToken,
          }),
        }),
      ),
    );
  });

  it("decodes edits and ignores any reply tags on them", () => {
    const encoded = encodeEditRumor(
      new EditMessageDraft({
        to: alice.pubkey,
        editOf: editId,
        content: MessageText.make("edited"),
      }),
      bob.pubkey,
      sentAt,
      clientId,
    );
    const rumor = new Rumor({
      ...encoded,
      tags: [...encoded.tags, ["e", replyId, "", "reply"]],
    });

    expect(decodeChatRumor(rumor, alice, wrapAuthor.pubkey)).toEqual(
      Either.right(
        expect.objectContaining({ editOf: editId, replyTo: null, root: null }),
      ),
    );
  });

  it.each([
    {
      name: "marked root and reply",
      tags: [
        ["e", rootId, "", "root"],
        ["e", replyId, "", "reply"],
      ],
      root: rootId,
      replyTo: replyId,
    },
    {
      name: "two unmarked tags",
      tags: [
        ["e", rootId],
        ["e", replyId],
      ],
      root: rootId,
      replyTo: replyId,
    },
    {
      name: "one unmarked tag",
      tags: [["e", rootId]],
      root: rootId,
      replyTo: null,
    },
  ])("extracts reply context from $name", ({ tags, root, replyTo }) => {
    const rumor = withHash({
      pubkey: bob.pubkey,
      created_at: sentAt,
      kind: 14,
      tags: [["p", alice.pubkey], ...tags],
      content: "reply",
    });

    expect(decodeChatRumor(rumor, alice, wrapAuthor.pubkey)).toEqual(
      Either.right(expect.objectContaining({ root, replyTo })),
    );
  });

  it.each([
    {
      name: "missing recipient",
      rumor: withHash({
        pubkey: bob.pubkey,
        created_at: sentAt,
        kind: 14,
        tags: [],
        content: "hello",
      }),
      reason: "invalid-message",
    },
    {
      name: "empty text",
      rumor: withHash({
        pubkey: bob.pubkey,
        created_at: sentAt,
        kind: 14,
        tags: [["p", alice.pubkey]],
        content: "   ",
      }),
      reason: "empty-message",
    },
    {
      name: "invalid edit reference",
      rumor: withHash({
        pubkey: bob.pubkey,
        created_at: sentAt,
        kind: 14,
        tags: [
          ["p", alice.pubkey],
          ["edited_from", "bad"],
        ],
        content: "edited",
      }),
      reason: "invalid-edit",
    },
    {
      name: "missing image tags",
      rumor: withHash({
        pubkey: bob.pubkey,
        created_at: sentAt,
        kind: 15,
        tags: [["p", alice.pubkey]],
        content: image.url,
      }),
      reason: "invalid-image",
    },
    {
      name: "wrong image encryption",
      rumor: withHash({
        pubkey: bob.pubkey,
        created_at: sentAt,
        kind: 15,
        tags: [
          ["p", alice.pubkey],
          ["file-type", image.fileType],
          ["encryption-algorithm", "aes-cbc"],
          ["decryption-key", image.key],
          ["decryption-nonce", image.nonce],
          ["x", image.encryptedSha256],
          ["ox", image.originalSha256],
          ["size", "1234"],
          ["dim", "640x480"],
        ],
        content: image.url,
      }),
      reason: "invalid-image",
    },
  ])("drops $name", ({ rumor, reason }) => {
    expect(decodeChatRumor(rumor, alice, wrapAuthor.pubkey)).toEqual(
      Either.left(reason),
    );
  });

  it("drops a real nested NIP-44 payload", () => {
    const content = encrypt(
      "nested",
      getConversationKey(bob.secretKey, alice.pubkey),
    );
    const rumor = withHash({
      pubkey: bob.pubkey,
      created_at: sentAt,
      kind: 14,
      tags: [["p", alice.pubkey]],
      content,
    });

    expect(decodeChatRumor(rumor, alice, wrapAuthor.pubkey)).toEqual(
      Either.left("nested-payload"),
    );
  });
});
