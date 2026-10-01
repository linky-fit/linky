import { Schema } from "effect";
import { ClientId, Pubkey, RumorId, UnixSeconds } from "../domain/primitives";
import { Emoji } from "./domain";

export class ReactionAdded extends Schema.TaggedClass<ReactionAdded>()(
  "ReactionAdded",
  {
    reactionId: RumorId,
    target: RumorId,
    from: Pubkey,
    emoji: Emoji,
    sentAt: UnixSeconds,
  },
) {}

/**
 * Our own reaction observed on a relay — the echo of the self copy, or a send
 * from another device. The reconciliation signal, distinct by construction
 * from an incoming reaction.
 */
export class OwnReactionConfirmed extends Schema.TaggedClass<OwnReactionConfirmed>()(
  "OwnReactionConfirmed",
  {
    reactionId: RumorId,
    target: RumorId,
    emoji: Emoji,
    clientId: Schema.NullOr(ClientId),
    sentAt: UnixSeconds,
  },
) {}

export class ReactionRetracted extends Schema.TaggedClass<ReactionRetracted>()(
  "ReactionRetracted",
  {
    reactionIds: Schema.NonEmptyArray(RumorId),
    from: Pubkey,
    sentAt: UnixSeconds,
  },
) {}

/** Echo of our own retraction; carries what the store needs to reconcile it. */
export class OwnRetractionConfirmed extends Schema.TaggedClass<OwnRetractionConfirmed>()(
  "OwnRetractionConfirmed",
  {
    retractionId: RumorId,
    reactionIds: Schema.NonEmptyArray(RumorId),
    clientId: Schema.NullOr(ClientId),
    sentAt: UnixSeconds,
  },
) {}

export const ReactionInboxEvent = Schema.Union([
  ReactionAdded,
  OwnReactionConfirmed,
  ReactionRetracted,
  OwnRetractionConfirmed,
]);
export type ReactionInboxEvent = typeof ReactionInboxEvent.Type;
