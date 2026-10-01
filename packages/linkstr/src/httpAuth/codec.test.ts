import { Schema } from "effect";
import { finalizeEvent, getPublicKey, nip98, verifyEvent } from "nostr-tools";
import { NostrSecretKey, UnixSeconds } from "../domain/primitives";
import { SignedPlainEvent } from "../internal/nostrEvent";
import {
  BLOSSOM_AUTH_EXPIRATION_SECONDS,
  BLOSSOM_AUTH_KIND,
  HTTP_AUTH_KIND,
  makeBlossomUploadAuthHeader,
  makeNip98AuthHeader,
  makePushOwnershipProof,
  verifyPushOwnershipProof,
} from "./codec";

const secretKey = NostrSecretKey.make(new Uint8Array(32).fill(1));
const pubkey = getPublicKey(secretKey);
const now = UnixSeconds.make(1_754_000_000);
const decodeSignedEvent = Schema.decodeUnknownSync(SignedPlainEvent);
const textDecoder = new TextDecoder();

const decodeHeader = (
  header: string,
  variant: "base64" | "base64url",
): SignedPlainEvent => {
  expect(header.startsWith("Nostr ")).toBe(true);
  const encoded = header.slice("Nostr ".length);
  const normalized =
    variant === "base64url"
      ? encoded.replace(/-/g, "+").replace(/_/g, "/")
      : encoded;
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(`${normalized}${padding}`), (character) =>
    character.charCodeAt(0),
  );
  return decodeSignedEvent(JSON.parse(textDecoder.decode(bytes)));
};

const expectValidEvent = (event: SignedPlainEvent): void => {
  expect(event.created_at).toBe(now);
  expect(event.pubkey).toBe(pubkey);
  expect(verifyEvent(event)).toBe(true);
};

describe("HTTP auth encoding", () => {
  it("preserves the Blossom upload auth wire shape and base64url encoding", () => {
    const header = makeBlossomUploadAuthHeader(
      {
        sha256:
          "b08f138c9be318d9b407adf4f9c3f4248189aa3b15de606b93b3f0a2f31a465f",
        serverDomain: "blossom.example",
      },
      secretKey,
      now,
    );
    const event = decodeHeader(header, "base64url");

    expect(header.slice("Nostr ".length)).not.toMatch(/[+/=]/);
    expect(event).toEqual(
      expect.objectContaining({
        kind: BLOSSOM_AUTH_KIND,
        tags: [
          ["t", "upload"],
          ["expiration", String(now + BLOSSOM_AUTH_EXPIRATION_SECONDS)],
          [
            "x",
            "b08f138c9be318d9b407adf4f9c3f4248189aa3b15de606b93b3f0a2f31a465f",
          ],
          ["server", "blossom.example"],
        ],
        content: "Upload Blob",
      }),
    );
    expectValidEvent(event);
  });

  it("preserves the push ownership proof wire shape for both actions", () => {
    const subscribe = makePushOwnershipProof(
      { action: "subscribe", challenge: "challenge-1" },
      secretKey,
      now,
    );
    const unsubscribe = makePushOwnershipProof(
      { action: "unsubscribe", challenge: "challenge-2" },
      secretKey,
      now,
    );

    expect(subscribe).toEqual(
      expect.objectContaining({
        kind: HTTP_AUTH_KIND,
        tags: [
          ["challenge", "challenge-1"],
          ["action", "subscribe"],
          ["pubkey", pubkey],
        ],
        content: "linky-push-subscribe",
      }),
    );
    expect(unsubscribe.tags).toEqual([
      ["challenge", "challenge-2"],
      ["action", "unsubscribe"],
      ["pubkey", unsubscribe.pubkey],
    ]);
    expect(unsubscribe.content).toBe("linky-push-unsubscribe");
    expectValidEvent(subscribe);
    expectValidEvent(unsubscribe);
  });

  it("verifies the shared push ownership proof contract", () => {
    const event = makePushOwnershipProof(
      { action: "subscribe", challenge: "challenge-1" },
      secretKey,
      now,
    );
    const verified = verifyPushOwnershipProof(event);

    expect(verified._tag).toBe("Success");
    if (verified._tag === "Success") {
      expect(verified.success).toEqual(
        expect.objectContaining({
          action: "subscribe",
          challenge: "challenge-1",
        }),
      );
      expect(verified.success.event.id).toBe(event.id);
    }
  });

  it("rejects ownership proofs whose signed wire shape drifts", () => {
    const event = makePushOwnershipProof(
      { action: "subscribe", challenge: "challenge-1" },
      secretKey,
      now,
    );
    const wrongContent = finalizeEvent(
      {
        kind: event.kind,
        created_at: event.created_at,
        tags: event.tags,
        content: "wrong",
      },
      secretKey,
    );
    const duplicateChallenge = finalizeEvent(
      {
        kind: event.kind,
        created_at: event.created_at,
        tags: [...event.tags, ["challenge", "challenge-2"]],
        content: event.content,
      },
      secretKey,
    );

    expect(verifyPushOwnershipProof(wrongContent)).toEqual(
      expect.objectContaining({ _tag: "Failure", failure: "wrong-content" }),
    );
    expect(verifyPushOwnershipProof(duplicateChallenge)).toEqual(
      expect.objectContaining({
        _tag: "Failure",
        failure: "invalid-challenge",
      }),
    );
  });

  it("rejects non-hex signatures as malformed events", () => {
    const event = makePushOwnershipProof(
      { action: "subscribe", challenge: "challenge-1" },
      secretKey,
      now,
    );

    expect(verifyPushOwnershipProof({ ...event, sig: "not-hex" })).toEqual(
      expect.objectContaining({ _tag: "Failure", failure: "malformed-event" }),
    );
  });

  it("rejects valid-hex incorrect signatures as invalid signatures", () => {
    const event = makePushOwnershipProof(
      { action: "subscribe", challenge: "challenge-1" },
      secretKey,
      now,
    );

    expect(
      verifyPushOwnershipProof({ ...event, sig: "00".repeat(64) }),
    ).toEqual(
      expect.objectContaining({
        _tag: "Failure",
        failure: "invalid-signature",
      }),
    );
  });

  it("distinguishes invalid pubkey tag shape from a pubkey mismatch", () => {
    const event = makePushOwnershipProof(
      { action: "subscribe", challenge: "challenge-1" },
      secretKey,
      now,
    );
    const duplicatePubkey = finalizeEvent(
      {
        kind: event.kind,
        created_at: event.created_at,
        tags: [...event.tags, ["pubkey", event.pubkey]],
        content: event.content,
      },
      secretKey,
    );
    const missingPubkey = finalizeEvent(
      {
        kind: event.kind,
        created_at: event.created_at,
        tags: event.tags.filter((tag) => tag[0] !== "pubkey"),
        content: event.content,
      },
      secretKey,
    );
    const valuelessPubkey = finalizeEvent(
      {
        kind: event.kind,
        created_at: event.created_at,
        tags: event.tags.map((tag) => (tag[0] === "pubkey" ? ["pubkey"] : tag)),
        content: event.content,
      },
      secretKey,
    );
    const mismatchedPubkey = finalizeEvent(
      {
        kind: event.kind,
        created_at: event.created_at,
        tags: event.tags.map((tag) =>
          tag[0] === "pubkey"
            ? ["pubkey", getPublicKey(new Uint8Array(32).fill(2))]
            : tag,
        ),
        content: event.content,
      },
      secretKey,
    );

    for (const malformedTagEvent of [
      duplicatePubkey,
      missingPubkey,
      valuelessPubkey,
    ]) {
      expect(verifyPushOwnershipProof(malformedTagEvent)).toEqual(
        expect.objectContaining({
          _tag: "Failure",
          failure: "invalid-pubkey-tag",
        }),
      );
    }
    expect(verifyPushOwnershipProof(mismatchedPubkey)).toEqual(
      expect.objectContaining({ _tag: "Failure", failure: "invalid-pubkey" }),
    );
  });

  it("preserves the NIP-98 wire shape and standard base64 encoding", () => {
    const payload = { mintUrl: "https://mint.example" };
    const header = makeNip98AuthHeader(
      {
        url: "https://npub.example/api/v1/info/mint",
        method: "PUT",
        payload,
      },
      secretKey,
      now,
    );
    const event = decodeHeader(header, "base64");

    expect(event).toEqual(
      expect.objectContaining({
        kind: HTTP_AUTH_KIND,
        tags: [
          ["u", "https://npub.example/api/v1/info/mint"],
          ["method", "PUT"],
          ["payload", nip98.hashPayload(payload)],
        ],
        content: "",
      }),
    );
    expectValidEvent(event);
  });

  it("matches nostr-tools NIP-98 tags and payload hashing", async () => {
    const url = "https://npub.example/api/v1/info/mint";
    const method = "PUT";
    const payload = { mintUrl: "https://mint.example/Bitcoin" };
    const header = makeNip98AuthHeader(
      { url, method, payload },
      secretKey,
      now,
    );
    const nostrToolsHeader = await nip98.getToken(
      url,
      method,
      (event) => finalizeEvent(event, secretKey),
      true,
      payload,
    );
    const event = decodeHeader(header, "base64");
    const nostrToolsEvent = decodeHeader(nostrToolsHeader, "base64");

    expect(event.kind).toBe(nostrToolsEvent.kind);
    expect(event.tags).toEqual(nostrToolsEvent.tags);
    expect(event.content).toBe(nostrToolsEvent.content);
    expect(event.tags[2]?.[1]).toBe(nostrToolsEvent.tags[2]?.[1]);
    expect(verifyEvent(nostrToolsEvent)).toBe(true);
  });

  it("omits the NIP-98 payload tag when no payload is provided", () => {
    const event = decodeHeader(
      makeNip98AuthHeader(
        { url: "https://npub.example/api/v1/info/mint", method: "GET" },
        secretKey,
        now,
      ),
      "base64",
    );

    expect(event.tags).toEqual([
      ["u", "https://npub.example/api/v1/info/mint"],
      ["method", "GET"],
    ]);
  });
});
