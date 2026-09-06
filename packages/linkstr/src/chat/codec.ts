import { Either, Schema } from "effect";
import { decrypt, getConversationKey } from "nostr-tools/nip44";
import {
  ClientId,
  isClientId,
  isPubkey,
  isRumorId,
  Pubkey,
  RumorId,
} from "../domain/primitives";
import type { UnixSeconds } from "../domain/primitives";
import type { DropReason } from "../inbox/events";
import {
  firstTagValue,
  firstTrimmedTagValue,
  Rumor,
  rumorWithHash,
  tagValues,
} from "../internal/nostrEvent";
import type { NostrTags } from "../internal/nostrEvent";
import type { LinkstrIdentityService } from "../services/LinkstrIdentity";
import { extractWholeCashuToken } from "./cashuToken";
import {
  CashuTokenText,
  EditMessageDraft,
  ImageMessageDraft,
  PrivateImage,
  TextMessageDraft,
  TokenMessageDraft,
} from "./domain";
import {
  ChatMessageReceived,
  ImageBody,
  OwnChatMessageConfirmed,
  TextBody,
  TokenBody,
} from "./events";
import type { ChatInboxEvent, MessageBody } from "./events";

export const CHAT_TEXT_KIND = 14;
export const CHAT_IMAGE_KIND = 15;

const decodePrivateImage = Schema.decodeUnknownEither(PrivateImage);
const isCashuTokenText = Schema.is(CashuTokenText);

const replyTags = (
  replyTo: RumorId | undefined,
  root: RumorId | undefined,
): NostrTags => {
  if (replyTo === undefined) return [];
  return [
    ["e", root ?? replyTo, "", "root"],
    ["e", replyTo, "", "reply"],
  ];
};

const encodeTextKindRumor = (
  draft: {
    readonly to: Pubkey;
    readonly content: string;
    readonly replyTo?: RumorId | undefined;
    readonly root?: RumorId | undefined;
  },
  author: Pubkey,
  sentAt: UnixSeconds,
  clientId: ClientId,
): Rumor =>
  rumorWithHash({
    pubkey: author,
    created_at: sentAt,
    kind: CHAT_TEXT_KIND,
    tags: [
      ["p", draft.to],
      ["p", author],
      ["client", clientId],
      ...replyTags(draft.replyTo, draft.root),
    ],
    content: draft.content,
  });

export const encodeTextMessageRumor = (
  draft: TextMessageDraft,
  author: Pubkey,
  sentAt: UnixSeconds,
  clientId: ClientId,
): Rumor => encodeTextKindRumor(draft, author, sentAt, clientId);

export const encodeTokenMessageRumor = (
  draft: TokenMessageDraft,
  author: Pubkey,
  sentAt: UnixSeconds,
  clientId: ClientId,
): Rumor =>
  encodeTextKindRumor(
    {
      to: draft.to,
      content: draft.token,
      ...(draft.replyTo === undefined ? {} : { replyTo: draft.replyTo }),
      ...(draft.root === undefined ? {} : { root: draft.root }),
    },
    author,
    sentAt,
    clientId,
  );

export const encodeImageMessageRumor = (
  draft: ImageMessageDraft,
  author: Pubkey,
  sentAt: UnixSeconds,
  clientId: ClientId,
): Rumor => {
  const { image } = draft;
  return rumorWithHash({
    pubkey: author,
    created_at: sentAt,
    kind: CHAT_IMAGE_KIND,
    tags: [
      ["p", draft.to],
      ["p", author],
      ["client", clientId],
      ["file-type", image.fileType],
      ["encryption-algorithm", image.encryptionAlgorithm],
      ["decryption-key", image.key],
      ["decryption-nonce", image.nonce],
      ["x", image.encryptedSha256],
      ["ox", image.originalSha256],
      ["size", String(image.encryptedSize)],
      ...(image.width !== undefined && image.height !== undefined
        ? [["dim", `${image.width}x${image.height}`]]
        : []),
      ...(image.fileName !== undefined ? [["name", image.fileName]] : []),
      ...(image.storageEncoding === "base64" ? [["encoding", "base64"]] : []),
      ...replyTags(draft.replyTo, draft.root),
    ],
    content: image.url,
  });
};

export const encodeEditRumor = (
  draft: EditMessageDraft,
  author: Pubkey,
  sentAt: UnixSeconds,
  clientId: ClientId,
): Rumor =>
  rumorWithHash({
    pubkey: author,
    created_at: sentAt,
    kind: CHAT_TEXT_KIND,
    tags: [
      ["p", draft.to],
      ["p", author],
      ["edited_from", draft.editOf],
      ["client", clientId],
    ],
    content: draft.content,
  });

const resolvePeer = (
  rumor: Rumor,
  me: Pubkey,
): Either.Either<Pubkey, DropReason> => {
  const recipients = tagValues(rumor.tags, "p");
  if (rumor.pubkey === me) {
    const peer = recipients.find(
      (candidate): candidate is Pubkey =>
        candidate !== me && isPubkey(candidate),
    );
    return peer === undefined
      ? Either.left("invalid-message")
      : Either.right(peer);
  }
  return recipients.includes(me)
    ? Either.right(rumor.pubkey)
    : Either.left("invalid-message");
};

const extractEditOf = (
  tags: NostrTags,
): Either.Either<RumorId | null, DropReason> => {
  const editTag = tags.find((tag) => tag[0] === "edited_from");
  if (editTag === undefined) return Either.right(null);
  const value = editTag[1]?.trim();
  return value !== undefined && isRumorId(value)
    ? Either.right(value)
    : Either.left("invalid-edit");
};

const extractReplyContext = (
  tags: NostrTags,
): { readonly replyTo: RumorId | null; readonly root: RumorId | null } => {
  const eventTags = tags.filter((tag) => tag[0] === "e");
  let root: RumorId | null = null;
  let replyTo: RumorId | null = null;
  let first: RumorId | null = null;
  let last: RumorId | null = null;

  for (const tag of eventTags) {
    const value = tag[1]?.trim();
    if (value === undefined || !isRumorId(value)) continue;
    first ??= value;
    last = value;
    const marker = tag[3]?.trim().toLowerCase();
    if (marker === "root") root ??= value;
    if (marker === "reply") replyTo ??= value;
  }

  if (replyTo === null && last !== null && eventTags.length > 1) replyTo = last;
  root ??= first;
  root ??= replyTo;
  return { replyTo, root };
};

const isNestedPayload = (
  content: string,
  identity: LinkstrIdentityService,
  candidates: ReadonlyArray<Pubkey>,
): boolean => {
  const uniqueCandidates = new Set<Pubkey>();
  for (const candidate of candidates) {
    if (uniqueCandidates.has(candidate)) continue;
    uniqueCandidates.add(candidate);
    try {
      decrypt(
        content.trim(),
        getConversationKey(identity.secretKey, candidate),
      );
      return true;
    } catch {
      continue;
    }
  }
  return false;
};

const decodeTextBody = (
  rumor: Rumor,
  identity: LinkstrIdentityService,
  peer: Pubkey,
  wrapPubkey: Pubkey,
): Either.Either<MessageBody, DropReason> => {
  if (rumor.content.trim() === "") return Either.left("empty-message");
  if (
    isNestedPayload(rumor.content, identity, [rumor.pubkey, peer, wrapPubkey])
  ) {
    return Either.left("nested-payload");
  }
  const candidate = extractWholeCashuToken(rumor.content);
  if (candidate !== null && isCashuTokenText(candidate)) {
    return Either.right(new TokenBody({ token: candidate }));
  }
  return Either.right(new TextBody({ text: rumor.content }));
};

const parseDimensions = (
  text: string | null,
): { width: number; height: number } | null => {
  const match = /^(\d+)x(\d+)$/i.exec(text ?? "");
  if (!match) return null;
  const width = Number.parseInt(match[1] ?? "", 10);
  const height = Number.parseInt(match[2] ?? "", 10);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
};

const decodeImageBody = (
  rumor: Rumor,
): Either.Either<MessageBody, DropReason> => {
  const url = rumor.content.trim();
  const fileType = firstTrimmedTagValue(rumor.tags, "file-type");
  const encryptionAlgorithm = firstTrimmedTagValue(
    rumor.tags,
    "encryption-algorithm",
  );
  const key = firstTrimmedTagValue(rumor.tags, "decryption-key");
  const nonce = firstTrimmedTagValue(rumor.tags, "decryption-nonce");
  const encryptedSha256 = firstTrimmedTagValue(rumor.tags, "x");
  const originalSha256 = firstTrimmedTagValue(rumor.tags, "ox");
  const sizeText = firstTrimmedTagValue(rumor.tags, "size");
  const dimensionText = firstTrimmedTagValue(rumor.tags, "dim");
  const fileName = firstTrimmedTagValue(rumor.tags, "name");
  const encoding = firstTrimmedTagValue(rumor.tags, "encoding");
  const dimensions = parseDimensions(dimensionText);
  const encryptedSize = Number.parseInt(sizeText ?? "", 10);
  const storageEncoding =
    encoding === "base64" ? "base64" : encoding === null ? "raw" : null;

  if (
    url === "" ||
    fileType === null ||
    encryptionAlgorithm !== "aes-gcm" ||
    key === null ||
    nonce === null ||
    encryptedSha256 === null ||
    originalSha256 === null ||
    storageEncoding === null ||
    !Number.isFinite(encryptedSize) ||
    encryptedSize <= 0 ||
    (dimensionText !== null && dimensions === null)
  ) {
    return Either.left("invalid-image");
  }

  return Either.match(
    decodePrivateImage({
      url,
      fileType,
      encryptionAlgorithm,
      key: key.toLowerCase(),
      nonce: nonce.toLowerCase(),
      encryptedSha256: encryptedSha256.toLowerCase(),
      originalSha256: originalSha256.toLowerCase(),
      encryptedSize: Math.trunc(encryptedSize),
      ...(dimensions ?? {}),
      ...(fileName === null ? {} : { fileName }),
      storageEncoding,
    }),
    {
      onLeft: () => Either.left("invalid-image"),
      onRight: (image) => Either.right(new ImageBody({ image })),
    },
  );
};

export const decodeChatRumor = (
  rumor: Rumor,
  identity: LinkstrIdentityService,
  wrapPubkey: Pubkey,
): Either.Either<ChatInboxEvent, DropReason> =>
  Either.gen(function* () {
    const peer = yield* resolvePeer(rumor, identity.pubkey);
    const editOf = yield* extractEditOf(rumor.tags);
    const { replyTo, root } =
      editOf === null
        ? extractReplyContext(rumor.tags)
        : { replyTo: null, root: null };
    const body = yield* (() => {
      switch (rumor.kind) {
        case CHAT_TEXT_KIND:
          return decodeTextBody(rumor, identity, peer, wrapPubkey);
        case CHAT_IMAGE_KIND:
          return decodeImageBody(rumor);
        default:
          return Either.left<DropReason>("unsupported-kind");
      }
    })();
    const messageId = rumor.id;
    if (!isRumorId(messageId)) {
      return yield* Either.left<DropReason>("invalid-message");
    }

    if (rumor.pubkey === identity.pubkey) {
      const clientTag = firstTagValue(rumor.tags, "client");
      return new OwnChatMessageConfirmed({
        messageId,
        to: peer,
        body,
        replyTo,
        root,
        editOf,
        clientId:
          clientTag !== null && isClientId(clientTag) ? clientTag : null,
        sentAt: rumor.created_at,
      });
    }

    return new ChatMessageReceived({
      messageId,
      from: peer,
      body,
      replyTo,
      root,
      editOf,
      sentAt: rumor.created_at,
    });
  });
