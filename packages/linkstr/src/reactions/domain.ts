import { Schema } from "effect";
import { WrapDelivery } from "../domain/delivery";
import { ClientId, Pubkey, RumorId, UnixSeconds } from "../domain/primitives";

export const Emoji = Schema.Trimmed.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(32),
).pipe(Schema.brand("Emoji"));
export type Emoji = typeof Emoji.Type;

/** Kind of the message being reacted to; the codec maps this to the ["k"] tag. */
export const TargetKind = Schema.Literals(["text", "image"]);
export type TargetKind = typeof TargetKind.Type;

export class ReactionDraft extends Schema.Class<ReactionDraft>("ReactionDraft")(
  {
    /** Conversation peer the reaction is sent to. */
    to: Pubkey,
    /** Message being reacted to. */
    target: RumorId,
    targetKind: TargetKind,
    targetAuthor: Pubkey,
    emoji: Emoji,
    /** Generated when omitted; pass it when an optimistic local row already exists. */
    clientId: Schema.optional(ClientId),
    sentAt: Schema.optional(UnixSeconds),
  },
) {}

export class RetractionDraft extends Schema.Class<RetractionDraft>(
  "RetractionDraft",
)({
  to: Pubkey,
  reactionIds: Schema.NonEmptyArray(RumorId),
  clientId: Schema.optional(ClientId),
}) {}

export class ReactionReceipt extends Schema.TaggedClass<ReactionReceipt>()(
  "ReactionReceipt",
  {
    rumorId: RumorId,
    clientId: ClientId,
    sentAt: UnixSeconds,
    selfCopy: WrapDelivery,
    recipientCopy: WrapDelivery,
  },
) {}

export class RetractionReceipt extends Schema.TaggedClass<RetractionReceipt>()(
  "RetractionReceipt",
  {
    rumorId: RumorId,
    clientId: ClientId,
    sentAt: UnixSeconds,
    selfCopy: WrapDelivery,
    recipientCopy: WrapDelivery,
  },
) {}
