import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { Option, Result, Schema } from "effect";
import type { Filter } from "nostr-tools";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";
import type { NostrSecretKey, Pubkey } from "../domain/primitives";
import { chunkAuthors } from "../internal/authorChunks";
import { firstTagValue, tagsNamed } from "../internal/nostrEvent";
import type { NostrTags, SignedPlainEvent } from "../internal/nostrEvent";
import type { PlainEventTemplate } from "../internal/plainEvent";
import { emptyListingsDocument, ListingsDocument } from "./domain";
import type { ListingsDraft } from "./domain";
import type { ListingsDropReason } from "./events";

/** Linky listings: an addressable event whose content only the author's chosen contacts can read. */
export const LISTINGS_KIND = 34133;
export const LISTINGS_D_TAG = "listings";
export const LISTINGS_VALUE = "listings";
/** `["slot", <slot id>, <content key wrapped for one recipient>]`. */
export const LISTINGS_SLOT_TAG = "slot";

const SLOT_ID_PREFIX = new TextEncoder().encode("linky/listings/slot/v1:");
const SLOT_ID_HEX_LENGTH = 32;
const CONTENT_KEY_HEX = /^[0-9a-f]{64}$/;

const concat = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  const out = new Uint8Array(left.length + right.length);
  out.set(left);
  out.set(right, left.length);
  return out;
};

/**
 * Both parties derive the slot id from their NIP-44 conversation key, so a
 * reader finds their slot without trial decryption and nobody else can tell
 * which pubkey a slot is for.
 */
export const listingsSlotId = (conversationKey: Uint8Array): string =>
  bytesToHex(sha256(concat(SLOT_ID_PREFIX, conversationKey))).slice(
    0,
    SLOT_ID_HEX_LENGTH,
  );

const decodeDocument = Schema.decodeUnknownOption(
  Schema.fromJsonString(ListingsDocument),
);
const encodeDocument = Schema.encodeSync(
  Schema.fromJsonString(ListingsDocument),
);

/**
 * One event per publish: the document under a fresh random content key, and
 * that key wrapped once per recipient under the pairwise conversation key. A
 * recipient dropped from `recipients` cannot read the next version, because
 * the key is new every time.
 */
export const encodeListingsEvent = (
  draft: ListingsDraft,
  secretKey: NostrSecretKey,
): PlainEventTemplate => {
  const contentKey = randomBytes(32);
  const contentKeyHex = bytesToHex(contentKey);
  const slots: NostrTags = [...new Set(draft.recipients)].map((recipient) => {
    const conversationKey = getConversationKey(secretKey, recipient);
    return [
      LISTINGS_SLOT_TAG,
      listingsSlotId(conversationKey),
      encrypt(contentKeyHex, conversationKey),
    ];
  });
  return {
    kind: LISTINGS_KIND,
    tags: [["d", LISTINGS_D_TAG], ["linky", LISTINGS_VALUE], ...slots],
    content: encrypt(encodeDocument(draft.document), contentKey),
  };
};

export const listingsFilters = (
  authors: ReadonlyArray<Pubkey>,
): Array<Filter> =>
  chunkAuthors(authors).map((chunk) => ({
    kinds: [LISTINGS_KIND],
    authors: chunk,
    "#d": [LISTINGS_D_TAG],
  }));

const tryDecrypt = (payload: string, key: Uint8Array): string | null => {
  try {
    return decrypt(payload, key);
  } catch {
    return null;
  }
};

/** The document a verified event of `LISTINGS_KIND` holds for the reader, empty when it has no slot for them, or why it is unreadable. */
export const decodeListingsEvent = (
  event: SignedPlainEvent,
  secretKey: NostrSecretKey,
): Result.Result<ListingsDocument, ListingsDropReason> => {
  if (event.kind !== LISTINGS_KIND) return Result.fail("unsupported-kind");
  if (firstTagValue(event.tags, "d") !== LISTINGS_D_TAG) {
    return Result.fail("other-d-tag");
  }
  const conversationKey = getConversationKey(secretKey, event.pubkey);
  const slotId = listingsSlotId(conversationKey);
  const slot = tagsNamed(event.tags, LISTINGS_SLOT_TAG).find(
    (tag) => tag[1] === slotId,
  );
  // The author stopped sharing with the reader, which withdraws everything from them.
  if (slot?.[2] === undefined) return Result.succeed(emptyListingsDocument);
  const contentKeyHex = tryDecrypt(slot[2], conversationKey);
  if (contentKeyHex === null || !CONTENT_KEY_HEX.test(contentKeyHex)) {
    return Result.fail("undecryptable");
  }
  const json = tryDecrypt(event.content, hexToBytes(contentKeyHex));
  if (json === null) return Result.fail("undecryptable");
  return Option.match(decodeDocument(json), {
    onNone: () => Result.fail("malformed-document"),
    onSome: (document) => Result.succeed(document),
  });
};
