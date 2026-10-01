import { Effect, Result, Schema } from "effect";
import {
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  verifyEvent,
} from "nostr-tools";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";
import { createSeal, wrapEvent } from "nostr-tools/nip59";
import type { NostrSecretKey, Pubkey } from "../domain/primitives";
import { Rumor, SignedSealEvent, SignedWrapEvent } from "./nostrEvent";
import { nowSeconds } from "./time";

export type UnwrapFailure =
  | "invalid-wrap"
  | "invalid-rumor-timestamp"
  | "unwrap-failed"
  | "invalid-seal"
  | "sender-forged"
  | "malformed-rumor"
  | "forged-rumor-id";

const decodeWrap = Schema.decodeUnknownSync(SignedWrapEvent);
const decodeSealResult = Schema.decodeUnknownResult(SignedSealEvent);
const decodeRumorResult = Schema.decodeUnknownResult(Rumor);

const TWO_DAYS_SECONDS = 2 * 24 * 60 * 60;
const MAX_FUTURE_RUMOR_SKEW_SECONDS = 5 * 60;

export const LINKY_PUSH_MARKER_TAG = "linky";
export const LINKY_PUSH_MARKER_VALUE = "push";

export interface WrapRumorOptions {
  readonly pushMarker?: boolean;
}

const randomTimestampSeconds = (): number =>
  Math.round(Math.round(Date.now() / 1000) - Math.random() * TWO_DAYS_SECONDS);

const createPushMarkedWrap = (
  rumor: Rumor,
  senderSecretKey: NostrSecretKey,
  recipient: Pubkey,
): SignedWrapEvent => {
  const seal = createSeal(rumor, senderSecretKey, recipient);
  const randomKey = generateSecretKey();
  return decodeWrap(
    finalizeEvent(
      {
        kind: 1059,
        content: encrypt(
          JSON.stringify(seal),
          getConversationKey(randomKey, recipient),
        ),
        created_at: randomTimestampSeconds(),
        tags: [
          ["p", recipient],
          [LINKY_PUSH_MARKER_TAG, LINKY_PUSH_MARKER_VALUE],
        ],
      },
      randomKey,
    ),
  );
};

export const wrapRumorFor = (
  rumor: Rumor,
  senderSecretKey: NostrSecretKey,
  recipient: Pubkey,
  options?: WrapRumorOptions,
): SignedWrapEvent =>
  options?.pushMarker === true
    ? createPushMarkedWrap(rumor, senderSecretKey, recipient)
    : decodeWrap(wrapEvent(rumor, senderSecretKey, recipient));

const decryptJson = (
  payload: string,
  recipientSecretKey: NostrSecretKey,
  senderPubkey: Pubkey,
): Result.Result<unknown, UnwrapFailure> => {
  try {
    return Result.succeed(
      JSON.parse(
        decrypt(payload, getConversationKey(recipientSecretKey, senderPubkey)),
      ),
    );
  } catch {
    return Result.fail("unwrap-failed");
  }
};

/**
 * Authenticated unwrap. nostr-tools' `unwrapEvent` verifies nothing, so this
 * decrypts by hand and enforces what NIP-59 leaves to the reader:
 * - the outer signature is valid before decrypting,
 * - the seal signature authenticates the sender,
 * - the rumor author is the seal author and not the ephemeral wrap key,
 *   otherwise the sender identity is forgeable,
 * - the rumor id is the hash of the rumor, otherwise dedupe, receipts and
 *   retraction references can be poisoned.
 */
export const unwrapToRumor = (
  wrap: SignedWrapEvent,
  recipientSecretKey: NostrSecretKey,
): Result.Result<Rumor, UnwrapFailure> =>
  Result.gen(function* () {
    if (!verifyEvent(wrap)) {
      return yield* Result.fail<UnwrapFailure>("invalid-wrap");
    }
    const sealJson = yield* decryptJson(
      wrap.content,
      recipientSecretKey,
      wrap.pubkey,
    );
    const seal = yield* decodeSealResult(sealJson).pipe(
      Result.mapError((): UnwrapFailure => "invalid-seal"),
    );
    if (!verifyEvent(seal)) {
      return yield* Result.fail<UnwrapFailure>("invalid-seal");
    }

    const rumorJson = yield* decryptJson(
      seal.content,
      recipientSecretKey,
      seal.pubkey,
    );
    const rumor = yield* decodeRumorResult(rumorJson).pipe(
      Result.mapError((): UnwrapFailure => "malformed-rumor"),
    );
    if (
      rumor.created_at >
      Effect.runSync(nowSeconds) + MAX_FUTURE_RUMOR_SKEW_SECONDS
    ) {
      return yield* Result.fail<UnwrapFailure>("invalid-rumor-timestamp");
    }
    if (rumor.pubkey !== seal.pubkey || rumor.pubkey === wrap.pubkey) {
      return yield* Result.fail<UnwrapFailure>("sender-forged");
    }
    if (rumor.id !== getEventHash(rumor)) {
      return yield* Result.fail<UnwrapFailure>("forged-rumor-id");
    }
    return rumor;
  });
