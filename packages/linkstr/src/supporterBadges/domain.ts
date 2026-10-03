import { Schema } from "effect";
import { WrapDelivery } from "../domain/delivery";
import {
  ClientId,
  EventId,
  Pubkey,
  RumorId,
  UnixSeconds,
} from "../domain/primitives";
import { SignedPlainEvent } from "../internal/nostrEvent";

export const SupporterTier = Schema.Literal(
  "bronze",
  "silver",
  "gold",
  "diamond",
);
export type SupporterTier = typeof SupporterTier.Type;

/** A tier badge, or `generic` for the badge that names no tier. */
export const SupporterBadgeType = Schema.Literal(
  ...SupporterTier.literals,
  "generic",
);
export type SupporterBadgeType = typeof SupporterBadgeType.Type;

/** The NIP-58 definition (kind 30009) of one supporter badge. */
export class BadgeDefinition extends Schema.Class<BadgeDefinition>(
  "BadgeDefinition",
)({
  badge: SupporterBadgeType,
  name: Schema.NonEmptyTrimmedString,
  description: Schema.String,
  image: Schema.NonEmptyTrimmedString,
  thumb: Schema.NonEmptyTrimmedString,
}) {}

/** A badge definition as found on relays, newest per badge. */
export class PublishedBadgeDefinition extends Schema.Class<PublishedBadgeDefinition>(
  "PublishedBadgeDefinition",
)({
  eventId: EventId,
  createdAt: UnixSeconds,
  definition: BadgeDefinition,
}) {}

/** The two signed kind 8 awards of one payment: tiered first, generic second. */
export const SupporterAwardEvents = Schema.Tuple(
  SignedPlainEvent,
  SignedPlainEvent,
);
export type SupporterAwardEvents = typeof SupporterAwardEvents.Type;

/** A kind 8 award verified against its issuer and supporter. */
export class SupporterAward extends Schema.Class<SupporterAward>(
  "SupporterAward",
)({
  badge: SupporterBadgeType,
  supporter: Pubkey,
  awardedAt: UnixSeconds,
  /** The signed award, to store and publish unchanged. */
  event: SignedPlainEvent,
}) {}

export const SupporterAwardDropReason = Schema.Literal(
  "malformed-event",
  "invalid-signature",
  "not-an-award",
  "wrong-issuer",
  "wrong-supporter",
  "not-a-supporter-badge",
);
export type SupporterAwardDropReason = typeof SupporterAwardDropReason.Type;

export const SupporterRefusalReason = Schema.Literal(
  "mint_not_accepted",
  "token_spent",
  "invalid_token",
);
export type SupporterRefusalReason = typeof SupporterRefusalReason.Type;

/** What the issuer answers to one supporter payment. */
export const SupporterResult = Schema.Union(
  Schema.Struct({
    status: Schema.Literal("issued"),
    tier: SupporterTier,
    awards: SupporterAwardEvents,
  }),
  Schema.Struct({ status: Schema.Literal("thanks") }),
  Schema.Struct({
    status: Schema.Literal("refused"),
    reason: SupporterRefusalReason,
  }),
);
export type SupporterResult = typeof SupporterResult.Type;

export class SupporterResultDraft extends Schema.Class<SupporterResultDraft>(
  "SupporterResultDraft",
)({
  to: Pubkey,
  /** Rumor id of the token message this result answers. */
  tokenMessageId: RumorId,
  result: SupporterResult,
  clientId: Schema.optional(ClientId),
  sentAt: Schema.optional(UnixSeconds),
}) {}

export class SupporterResultReceipt extends Schema.TaggedClass<SupporterResultReceipt>()(
  "SupporterResultReceipt",
  {
    rumorId: RumorId,
    clientId: ClientId,
    sentAt: UnixSeconds,
    recipientCopy: WrapDelivery,
  },
) {}

/** One NIP-58 `a` + `e` pair of a profile badges event. */
export class ProfileBadgeEntry extends Schema.Class<ProfileBadgeEntry>(
  "ProfileBadgeEntry",
)({
  /** `30009:<issuer>:<d>` */
  address: Schema.String,
  awardId: EventId,
}) {}

/** Your newest profile badges event (kind 30008, `d=profile_badges`). */
export class FetchedProfileBadges extends Schema.Class<FetchedProfileBadges>(
  "FetchedProfileBadges",
)({
  eventId: EventId,
  createdAt: UnixSeconds,
  entries: Schema.Array(ProfileBadgeEntry),
}) {}
