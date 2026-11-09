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
import { emptyListingsDocument, Listing, ListingsDocument } from "./domain";
import type { ListingsDraft } from "./domain";
import type { ListingsDropReason } from "./events";

/** Linky listings: an addressable event whose content only the author's chosen contacts can read. */
export const LISTINGS_KIND = 34133;
export const LISTINGS_D_TAG = "listings";
export const LISTINGS_VALUE = "listings";
/** `["slot", <slot id>, <content key wrapped for one recipient>, <audience keys wrapped for them, on every slot when the event has parts>]`. */
export const LISTINGS_SLOT_TAG = "slot";
/** `["part", <listings of one audience, under that audience's key>]`, in audience order. */
export const LISTINGS_PART_TAG = "part";

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

const PartListings = Schema.fromJsonString(Schema.Array(Listing));
const encodePart = Schema.encodeSync(PartListings);
const decodePart = Schema.decodeUnknownOption(PartListings);

/** `[[<part index>, <part key hex>], …]`: the parts one reader may open. */
const PartKeys = Schema.fromJsonString(
  Schema.Array(Schema.Tuple([Schema.Int, Schema.String])),
);
const encodePartKeys = Schema.encodeSync(PartKeys);
const decodePartKeys = Schema.decodeUnknownOption(PartKeys);

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
  parts: NostrTags,
  content: string,
  chunks: number,
): Array<PlainEventTemplate> =>
  Array.from({ length: chunks }, (_, chunk) => ({
    kind: LISTINGS_KIND,
    tags: [
      ["d", chunkDTag(chunk)],
      ["linky", LISTINGS_VALUE],
      ...(chunks > 1 ? [[LISTINGS_CHUNKS_TAG, String(chunks)]] : []),
      ...parts,
      ...slots.filter(
        (slot) => listingsChunkOf(slot[1] ?? "", chunks) === chunk,
      ),
    ],
    content,
  }));

/** Kept free beside the content and the parts, for the slots of a chunk. */
const SLOTS_ROOM_BYTES = 12_000;
/** Slots spread over chunks by hash, so a chunk may hold several even at one chunk per slot. */
const SLOTS_ROOM_MIN_SLOTS = 8;

const encryptedLength = (plaintext: string, key: Uint8Array): number => {
  try {
    return encrypt(plaintext, key).length;
  } catch {
    // NIP-44 refuses plaintext over 64 KiB, which no event fits anyway.
    return Number.POSITIVE_INFINITY;
  }
};

/**
 * The document with as many of its passed-on listings, first ones first, as
 * leave every chunk `reservedBytes` for its parts and slots; the author's own
 * listings are never cut, so passing listings on cannot keep them from the
 * relays.
 */
const withinBudget = (
  document: ListingsDocument,
  reservedBytes: number,
  contentKey: Uint8Array,
): ListingsDocument => {
  const passedOn = document.passedOn ?? [];
  const keeping = (count: number) =>
    new ListingsDocument({
      ...document,
      passedOn: passedOn.slice(0, count),
    });
  const fits = (count: number) =>
    encryptedLength(encodeDocument(keeping(count)), contentKey) +
      reservedBytes +
      SIGNED_EVENT_OVERHEAD_BYTES <=
    LISTINGS_MAX_EVENT_BYTES;
  if (passedOn.length === 0 || fits(passedOn.length)) return document;
  let low = 0;
  let high = passedOn.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return low === 0
    ? new ListingsDocument({ cash: document.cash, listings: document.listings })
    : keeping(low);
};

const fitsRelays = (template: PlainEventTemplate): boolean =>
  JSON.stringify(template).length + SIGNED_EVENT_OVERHEAD_BYTES <=
  LISTINGS_MAX_EVENT_BYTES;

/**
 * The events of one publish: the document under a fresh random content key,
 * and that key wrapped once per recipient under the pairwise conversation key.
 * A recipient dropped from `recipients` cannot read the next version, because
 * the key is new every time. Each audience's listings travel as a part under
 * a fresh key of its own, which only the slots of its recipients carry, so a
 * reader on a release without parts reads the document alone. Passed-on
 * listings beyond what leaves room for the slots are left out, last first.
 * The slots are
 * split over as few chunks as keep every event under
 * `LISTINGS_MAX_EVENT_BYTES`; each chunk carries the whole document and every
 * part and must be published, empty ones included, with one `created_at`.
 */
export const encodeListingsEvents = (
  draft: ListingsDraft,
  secretKey: NostrSecretKey,
): Array<PlainEventTemplate> => {
  const contentKey = randomBytes(32);
  const contentKeyHex = bytesToHex(contentKey);
  const audiences = draft.audiences.filter(
    (audience) =>
      audience.listings.length > 0 && audience.recipients.length > 0,
  );
  const partKeys = audiences.map(() => bytesToHex(randomBytes(32)));
  const parts: NostrTags = audiences.map((audience, index) => [
    LISTINGS_PART_TAG,
    encrypt(encodePart(audience.listings), hexToBytes(partKeys[index] ?? "")),
  ]);
  const recipients = [...new Set(draft.recipients)];
  const readable = recipients.map((recipient) =>
    encodePartKeys(
      audiences.flatMap((audience, index) =>
        audience.recipients.includes(recipient)
          ? [[index, partKeys[index] ?? ""] as const]
          : [],
      ),
    ),
  );
  // Padded to one length, so the slots of an audience's members look like everyone else's.
  const readableLength = Math.max(0, ...readable.map((json) => json.length));
  const slots: NostrTags = recipients.map((recipient, index) => {
    const conversationKey = getConversationKey(secretKey, recipient);
    return [
      LISTINGS_SLOT_TAG,
      listingsSlotId(conversationKey),
      encrypt(contentKeyHex, conversationKey),
      ...(parts.length > 0
        ? [
            encrypt(
              (readable[index] ?? "").padEnd(readableLength),
              conversationKey,
            ),
          ]
        : []),
    ];
  });
  const slotBytes = Math.max(
    0,
    ...slots.map((slot) => JSON.stringify(slot).length + 1),
  );
  const reservedBytes =
    JSON.stringify(parts).length +
    Math.max(SLOTS_ROOM_BYTES, SLOTS_ROOM_MIN_SLOTS * slotBytes);
  const content = encrypt(
    encodeDocument(withinBudget(draft.document, reservedBytes, contentKey)),
    contentKey,
  );
  let templates = chunkTemplates(slots, parts, content, 1);
  for (
    let chunks = 2;
    chunks <= slots.length && !templates.every(fitsRelays);
    chunks++
  ) {
    templates = chunkTemplates(slots, parts, content, chunks);
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

/** The listings of the parts the reader's slot opens; a part that does not open or decode is left out. */
const audienceListings = (
  event: SignedPlainEvent,
  wrappedPartKeys: string | undefined,
  conversationKey: Uint8Array,
): ReadonlyArray<Listing> => {
  if (wrappedPartKeys === undefined) return [];
  const keys = Option.getOrNull(
    decodePartKeys(tryDecrypt(wrappedPartKeys, conversationKey) ?? ""),
  );
  if (keys === null) return [];
  const parts = tagsNamed(event.tags, LISTINGS_PART_TAG);
  return keys.flatMap(([index, keyHex]) => {
    const part = parts[index]?.[1];
    if (part === undefined || !CONTENT_KEY_HEX.test(keyHex)) return [];
    const json = tryDecrypt(part, hexToBytes(keyHex));
    return json === null ? [] : Option.getOrElse(decodePart(json), () => []);
  });
};

/**
 * The document a verified event of `LISTINGS_KIND` holds for the reader, or
 * why it holds none: its listings followed by those of the parts the reader's
 * slot opens. Only the chunk that would carry the reader's slot decides:
 * empty when the slot is not there, because the author stopped sharing with
 * the reader.
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
    onSome: (document) => {
      const extra = audienceListings(event, slot[3], conversationKey);
      return Result.succeed(
        extra.length === 0
          ? document
          : new ListingsDocument({
              ...document,
              listings: [...document.listings, ...extra],
            }),
      );
    },
  });
};
