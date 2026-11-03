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

/** `["chunks", <count>]` on every event of a publish split into more than one. */
export const LISTINGS_CHUNKS_TAG = "chunks";
/** Under the 64 KiB message cap common relays set, with room for the `EVENT` envelope, id, pubkey and signature. */
export const LISTINGS_MAX_EVENT_BYTES = 60_000;
const SIGNED_EVENT_OVERHEAD_BYTES = 400;

/** The chunk of a publish split into `chunks` that carries the slot `slotId`. */
export const listingsChunkOf = (slotId: string, chunks: number): number =>
  Number.parseInt(slotId.slice(0, 8), 16) % chunks;

const chunkDTag = (chunk: number): string =>
  chunk === 0 ? LISTINGS_D_TAG : `${LISTINGS_D_TAG}:${chunk}`;

const chunkTemplates = (
  slots: ReadonlyArray<NostrTags[number]>,
  content: string,
  chunks: number,
): Array<PlainEventTemplate> =>
  Array.from({ length: chunks }, (_, chunk) => ({
    kind: LISTINGS_KIND,
    tags: [
      ["d", chunkDTag(chunk)],
      ["linky", LISTINGS_VALUE],
      ...(chunks > 1 ? [[LISTINGS_CHUNKS_TAG, String(chunks)]] : []),
      ...slots.filter(
        (slot) => listingsChunkOf(slot[1] ?? "", chunks) === chunk,
      ),
    ],
    content,
  }));

const fitsRelays = (template: PlainEventTemplate): boolean =>
  JSON.stringify(template).length + SIGNED_EVENT_OVERHEAD_BYTES <=
  LISTINGS_MAX_EVENT_BYTES;

/**
 * The events of one publish: the document under a fresh random content key,
 * and that key wrapped once per recipient under the pairwise conversation key.
 * A recipient dropped from `recipients` cannot read the next version, because
 * the key is new every time. The slots are split over as few chunks as keep
 * every event under `LISTINGS_MAX_EVENT_BYTES`; each chunk carries the whole
 * document and must be published, empty ones included, with one `created_at`.
 */
export const encodeListingsEvents = (
  draft: ListingsDraft,
  secretKey: NostrSecretKey,
): Array<PlainEventTemplate> => {
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
  const content = encrypt(encodeDocument(draft.document), contentKey);
  let templates = chunkTemplates(slots, content, 1);
  for (
    let chunks = 2;
    chunks <= slots.length && !templates.every(fitsRelays);
    chunks++
  ) {
    templates = chunkTemplates(slots, content, chunks);
  }
  return templates;
};

/** Every listings event of `authors`, whatever its chunk. */
export const listingsFilters = (
  authors: ReadonlyArray<Pubkey>,
): Array<Filter> =>
  chunkAuthors(authors).map((chunk) => ({
    kinds: [LISTINGS_KIND],
    authors: chunk,
  }));

const CHUNK_D_TAG = new RegExp(`^${LISTINGS_D_TAG}(?::([1-9][0-9]{0,3}))?$`);
const CHUNK_COUNT = /^[1-9][0-9]{0,3}$/;

const tryDecrypt = (payload: string, key: Uint8Array): string | null => {
  try {
    return decrypt(payload, key);
  } catch {
    return null;
  }
};

/** Which chunk of how many an event is. */
const chunkPosition = (
  event: SignedPlainEvent,
): Result.Result<
  { readonly chunk: number; readonly chunks: number },
  ListingsDropReason
> => {
  const match = CHUNK_D_TAG.exec(firstTagValue(event.tags, "d") ?? "");
  if (match === null) return Result.fail("other-d-tag");
  const count = firstTagValue(event.tags, LISTINGS_CHUNKS_TAG) ?? "1";
  const chunk = Number(match[1] ?? "0");
  const chunks = Number(count);
  return CHUNK_COUNT.test(count) && chunk < chunks
    ? Result.succeed({ chunk, chunks })
    : Result.fail("malformed-chunk");
};

/**
 * The document a verified event of `LISTINGS_KIND` holds for the reader, or
 * why it holds none. Only the chunk that would carry the reader's slot
 * decides: empty when the slot is not there, because the author stopped
 * sharing with the reader.
 */
export const decodeListingsEvent = (
  event: SignedPlainEvent,
  secretKey: NostrSecretKey,
): Result.Result<ListingsDocument, ListingsDropReason> => {
  if (event.kind !== LISTINGS_KIND) return Result.fail("unsupported-kind");
  const position = chunkPosition(event);
  if (Result.isFailure(position)) return Result.fail(position.failure);
  const { chunk, chunks } = position.success;
  const conversationKey = getConversationKey(secretKey, event.pubkey);
  const slotId = listingsSlotId(conversationKey);
  if (listingsChunkOf(slotId, chunks) !== chunk) {
    return Result.fail("other-chunk");
  }
  const slot = tagsNamed(event.tags, LISTINGS_SLOT_TAG).find(
    (tag) => tag[1] === slotId,
  );
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
