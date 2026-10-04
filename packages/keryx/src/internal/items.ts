import { Either, ParseResult, Schema } from "effect";
import type { Announcement, Attachment } from "../domain";
import { canonicalJsonBytes } from "./canonicalJson";
import { base64UrlToBytesOrNull, isSha256Hex } from "./crypto";
import { decodeUtf8, parseJsonBytes } from "./fetchBytes";
import { checkSignatures } from "./metadata";
import type { Authority, SignatureEntry } from "./metadata";
import { parseKeryxUrl } from "./urls";
import { ItemFields, SignedItem } from "./wire";

const isDataUrl = (value: string): boolean =>
  /^data:[^,]*;base64,/i.test(value);

const attachmentOf = (
  attachment: ItemFields["attachments"][number],
): Either.Either<Attachment, string> => {
  if (parseKeryxUrl(attachment.url) === null) {
    return Either.left("attachment url is not HTTPS");
  }
  if (attachment.sha256 !== undefined && !isSha256Hex(attachment.sha256)) {
    return Either.left("attachment sha256 is not lowercase hex");
  }
  return Either.right({
    url: attachment.url,
    ...(attachment.name === undefined ? {} : { name: attachment.name }),
    ...(attachment.mime_type === undefined
      ? {}
      : { mimeType: attachment.mime_type }),
    ...(attachment.size_in_bytes === undefined
      ? {}
      : { sizeInBytes: attachment.size_in_bytes }),
    ...(attachment.sha256 === undefined ? {} : { sha256: attachment.sha256 }),
  });
};

const imageOf = (
  fields: ItemFields,
): Either.Either<Pick<Announcement, "image" | "imageSha256">, string> => {
  const { image, image_sha256: sha256 } = fields;
  if (image === undefined || isDataUrl(image)) {
    return Either.right(image === undefined ? {} : { image });
  }
  if (parseKeryxUrl(image) === null) {
    return Either.left("image is neither a data URL nor HTTPS");
  }
  return sha256 !== undefined && isSha256Hex(sha256)
    ? Either.right({ image, imageSha256: sha256 })
    : Either.left("linked image without image_sha256");
};

/** Item fields as an announcement, or why the item breaks the schema. */
export const announcementOf = (
  fields: ItemFields,
  source: Pick<Announcement, "channel" | "privateFeedUrl" | "itemFile">,
): Either.Either<Announcement, string> =>
  Either.gen(function* () {
    const image = yield* imageOf(fields);
    const attachments = yield* Either.all(fields.attachments.map(attachmentOf));
    return {
      ...source,
      id: fields.id,
      title: fields.title,
      contentHtml: fields.content_html,
      ...image,
      datePublished: fields.date_published,
      ...(fields.date_modified === undefined
        ? {}
        : { dateModified: fields.date_modified }),
      tags: fields.tags,
      ...(fields.language === undefined ? {} : { language: fields.language }),
      attachments,
    };
  });

export const decodeWith = <A, I>(
  schema: Schema.Schema<A, I>,
  value: unknown,
): Either.Either<A, string> =>
  Schema.decodeUnknownEither(schema)(value).pipe(
    Either.mapLeft(ParseResult.TreeFormatter.formatErrorSync),
  );

/**
 * Feeds §1.2: authorized keys whose signature fails reject the document,
 * signatures by other keys are ignored, and the threshold must be met.
 */
export const checkDocumentSignatures = (
  document: Readonly<Record<string, unknown>>,
  signatures: ReadonlyArray<SignatureEntry>,
  authority: Authority,
): Either.Either<void, string> => {
  const message = canonicalJsonBytes(
    Object.fromEntries(
      Object.entries(document).filter(([key]) => key !== "sig"),
    ),
  );
  if (message === null) return Either.left("not canonical JSON");
  const result = checkSignatures(
    authority,
    signatures,
    message,
    base64UrlToBytesOrNull,
  );
  if (result.authorizedInvalid) return Either.left("bad signature");
  return result.valid >= authority.threshold
    ? Either.void
    : Either.left("signature threshold not met");
};

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const asObject = (
  value: unknown,
): Either.Either<Readonly<Record<string, unknown>>, string> =>
  isObject(value) ? Either.right(value) : Either.left("not a JSON object");

/** A downloaded channel item file, verified against the channel's item-signing authority. */
export const verifyChannelItem = (options: {
  readonly bytes: Uint8Array;
  readonly channel: string;
  readonly id: string;
  readonly authority: Authority;
}): Either.Either<Announcement, string> =>
  Either.gen(function* () {
    const itemFile = decodeUtf8(options.bytes);
    if (itemFile === null) return yield* Either.left("not UTF-8");
    const raw = yield* asObject(parseJsonBytes(options.bytes));
    const item = yield* decodeWith(SignedItem, raw);
    if (item.id !== options.id) {
      return yield* Either.left("id does not match the target path");
    }
    yield* checkDocumentSignatures(raw, item.sig, options.authority);
    return yield* announcementOf(item, { channel: options.channel, itemFile });
  });
