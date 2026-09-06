import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Either } from "effect";
import { getPublicKey } from "nostr-tools";
import type { NostrSecretKey, UnixSeconds } from "../domain/primitives";
import { singleTagValue } from "../internal/nostrEvent";
import type { SignedPlainEvent } from "../internal/nostrEvent";
import { decodeVerifiedPlainEvent } from "../internal/plainEvent";
import { signPlainEvent } from "../internal/plainEvent";
import type {
  BlossomUploadAuthDraft,
  Nip98AuthDraft,
  PushOwnershipProofDraft,
} from "./domain";

export const BLOSSOM_AUTH_KIND = 24242;
export const BLOSSOM_AUTH_EXPIRATION_SECONDS = 600;
export const HTTP_AUTH_KIND = 27235;

export type PushOwnershipProofFailure =
  | "malformed-event"
  | "invalid-signature"
  | "wrong-kind"
  | "invalid-challenge"
  | "invalid-action"
  | "invalid-pubkey-tag"
  | "invalid-pubkey"
  | "wrong-content";

export interface VerifiedPushOwnershipProof {
  readonly event: SignedPlainEvent;
  readonly action: PushOwnershipProofDraft["action"];
  readonly challenge: string;
}

const utf8Encoder = new TextEncoder();

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const bytesToBase64Url = (bytes: Uint8Array): string =>
  bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const encodeEvent = (event: SignedPlainEvent): Uint8Array =>
  utf8Encoder.encode(JSON.stringify(event));

export const makeBlossomUploadAuthHeader = (
  draft: BlossomUploadAuthDraft,
  secretKey: NostrSecretKey,
  now: UnixSeconds,
): string => {
  const event = signPlainEvent(
    {
      kind: BLOSSOM_AUTH_KIND,
      tags: [
        ["t", "upload"],
        ["expiration", String(now + BLOSSOM_AUTH_EXPIRATION_SECONDS)],
        ["x", draft.sha256],
        ["server", draft.serverDomain],
      ],
      content: "Upload Blob",
    },
    now,
    secretKey,
  );

  return `Nostr ${bytesToBase64Url(encodeEvent(event))}`;
};

export const makePushOwnershipProof = (
  draft: PushOwnershipProofDraft,
  secretKey: NostrSecretKey,
  now: UnixSeconds,
): SignedPlainEvent => {
  const pubkey = getPublicKey(secretKey);
  return signPlainEvent(
    {
      kind: HTTP_AUTH_KIND,
      tags: [
        ["challenge", draft.challenge],
        ["action", draft.action],
        ["pubkey", pubkey],
      ],
      content: `linky-push-${draft.action}`,
    },
    now,
    secretKey,
  );
};

/** Verifies the complete kind-27235 wire contract shared by client and server. */
export const verifyPushOwnershipProof = (
  input: unknown,
): Either.Either<VerifiedPushOwnershipProof, PushOwnershipProofFailure> =>
  Either.gen(function* () {
    const event = yield* decodeVerifiedPlainEvent(input).pipe(
      Either.mapLeft((failure): PushOwnershipProofFailure => failure),
    );
    if (event.kind !== HTTP_AUTH_KIND) {
      return yield* Either.left<PushOwnershipProofFailure>("wrong-kind");
    }
    const challenge = singleTagValue(event.tags, "challenge");
    if (challenge === null || challenge.length === 0) {
      return yield* Either.left<PushOwnershipProofFailure>("invalid-challenge");
    }
    const action = singleTagValue(event.tags, "action");
    if (action !== "subscribe" && action !== "unsubscribe") {
      return yield* Either.left<PushOwnershipProofFailure>("invalid-action");
    }
    const pubkey = singleTagValue(event.tags, "pubkey");
    if (pubkey === null) {
      return yield* Either.left<PushOwnershipProofFailure>(
        "invalid-pubkey-tag",
      );
    }
    if (pubkey !== event.pubkey) {
      return yield* Either.left<PushOwnershipProofFailure>("invalid-pubkey");
    }
    if (event.content !== `linky-push-${action}`) {
      return yield* Either.left<PushOwnershipProofFailure>("wrong-content");
    }
    return { event, action, challenge };
  });

export const makeNip98AuthHeader = (
  draft: Nip98AuthDraft,
  secretKey: NostrSecretKey,
  now: UnixSeconds,
): string => {
  const payloadTag = draft.payload
    ? [
        [
          "payload",
          bytesToHex(sha256(utf8Encoder.encode(JSON.stringify(draft.payload)))),
        ],
      ]
    : [];
  const event = signPlainEvent(
    {
      kind: HTTP_AUTH_KIND,
      tags: [["u", draft.url], ["method", draft.method], ...payloadTag],
      content: "",
    },
    now,
    secretKey,
  );

  return `Nostr ${bytesToBase64(encodeEvent(event))}`;
};
