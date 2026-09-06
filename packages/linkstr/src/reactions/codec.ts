import { Either, Schema } from "effect";
import { isClientId, isRumorId } from "../domain/primitives";
import type { ClientId, Pubkey, UnixSeconds } from "../domain/primitives";
import {
  firstTagValue,
  Rumor,
  rumorWithHash,
  tagValues,
} from "../internal/nostrEvent";
import { Emoji } from "./domain";
import type { ReactionDraft, RetractionDraft, TargetKind } from "./domain";
import type { DropReason } from "../inbox/events";
import {
  OwnReactionConfirmed,
  OwnRetractionConfirmed,
  ReactionAdded,
  ReactionRetracted,
} from "./events";
import type { ReactionInboxEvent } from "./events";

export const REACTION_KIND = 7;
export const RETRACTION_KIND = 5;

const targetKindTag: Record<TargetKind, "14" | "15"> = {
  text: "14",
  image: "15",
};

const isEmoji = Schema.is(Emoji);

export const encodeReactionRumor = (
  draft: ReactionDraft,
  author: Pubkey,
  sentAt: UnixSeconds,
  clientId: ClientId,
): Rumor =>
  rumorWithHash({
    pubkey: author,
    created_at: sentAt,
    kind: REACTION_KIND,
    tags: [
      ["p", draft.targetAuthor],
      ["p", draft.to],
      ["p", author],
      ["e", draft.target],
      ["k", targetKindTag[draft.targetKind]],
      ["client", clientId],
    ],
    content: draft.emoji,
  });

export const encodeRetractionRumor = (
  draft: RetractionDraft,
  author: Pubkey,
  sentAt: UnixSeconds,
  clientId: ClientId,
): Rumor =>
  rumorWithHash({
    pubkey: author,
    created_at: sentAt,
    kind: RETRACTION_KIND,
    tags: [
      ["p", draft.to],
      ["p", author],
      ...draft.reactionIds.map(
        (reactionId): Array<string> => ["e", reactionId],
      ),
      ["client", clientId],
    ],
    content: "",
  });

const decodeAddedOrConfirmed = (
  rumor: Rumor,
  me: Pubkey,
): Either.Either<ReactionInboxEvent, DropReason> => {
  const target = firstTagValue(rumor.tags, "e");
  if (target === null || !isRumorId(target)) {
    return Either.left("invalid-reaction");
  }
  // Reactions to anything but chat messages are foreign to Linky.
  const kindTag = firstTagValue(rumor.tags, "k");
  if (kindTag !== null && kindTag !== "14" && kindTag !== "15") {
    return Either.left("invalid-reaction");
  }
  const reactionId = rumor.id;
  if (!isRumorId(reactionId)) return Either.left("invalid-reaction");
  const emoji = rumor.content.trim();
  if (!isEmoji(emoji)) return Either.left("invalid-reaction");

  if (rumor.pubkey === me) {
    const clientTag = firstTagValue(rumor.tags, "client");
    return Either.right(
      new OwnReactionConfirmed({
        reactionId,
        target,
        emoji,
        clientId:
          clientTag !== null && isClientId(clientTag) ? clientTag : null,
        sentAt: rumor.created_at,
      }),
    );
  }

  return Either.right(
    new ReactionAdded({
      reactionId,
      target,
      from: rumor.pubkey,
      emoji,
      sentAt: rumor.created_at,
    }),
  );
};

const decodeRetracted = (
  rumor: Rumor,
  me: Pubkey,
): Either.Either<ReactionInboxEvent, DropReason> => {
  // Foreign clients may reference non-rumor ids in a deletion; retract what we
  // can identify instead of rejecting the whole rumor (matches NIP-09 usage).
  const [head, ...tail] = tagValues(rumor.tags, "e").filter(isRumorId);
  if (head === undefined) return Either.left("invalid-retraction");
  const reactionIds: [typeof head, ...typeof tail] = [head, ...tail];

  if (rumor.pubkey === me) {
    const retractionId = rumor.id;
    if (!isRumorId(retractionId)) return Either.left("invalid-retraction");
    const clientTag = firstTagValue(rumor.tags, "client");
    return Either.right(
      new OwnRetractionConfirmed({
        retractionId,
        reactionIds,
        clientId:
          clientTag !== null && isClientId(clientTag) ? clientTag : null,
        sentAt: rumor.created_at,
      }),
    );
  }

  return Either.right(
    new ReactionRetracted({
      reactionIds,
      from: rumor.pubkey,
      sentAt: rumor.created_at,
    }),
  );
};

export const decodeReactionRumor = (
  rumor: Rumor,
  me: Pubkey,
): Either.Either<ReactionInboxEvent, DropReason> => {
  switch (rumor.kind) {
    case REACTION_KIND:
      return decodeAddedOrConfirmed(rumor, me);
    case RETRACTION_KIND:
      return decodeRetracted(rumor, me);
    default:
      return Either.left("unsupported-kind");
  }
};
