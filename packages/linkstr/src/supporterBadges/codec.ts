import { Either, Option, Schema } from "effect";
import { EventId, isRumorId } from "../domain/primitives";
import type { ClientId, Pubkey, UnixSeconds } from "../domain/primitives";
import type { DropReason } from "../inbox/events";
import {
  firstTagValue,
  Rumor,
  rumorWithHash,
  singleTagValue,
  tagValues,
} from "../internal/nostrEvent";
import type { NostrTags, SignedPlainEvent } from "../internal/nostrEvent";
import { decodeVerifiedPlainEvent } from "../internal/plainEvent";
import type { PlainEventTemplate } from "../internal/plainEvent";
import {
  BadgeDefinition,
  ProfileBadgeEntry,
  SupporterAward,
  SupporterBadgeType,
  SupporterResult,
} from "./domain";
import type { SupporterAwardDropReason, SupporterResultDraft } from "./domain";
import { SupporterResultReceived } from "./events";
import type { SupporterResultInboxEvent } from "./events";

export const BADGE_AWARD_KIND = 8;
export const PROFILE_BADGES_KIND = 30008;
export const BADGE_DEFINITION_KIND = 30009;
export const PROFILE_BADGES_D = "profile_badges";
export const SUPPORTER_RESULT_KIND = 24137;
export const SUPPORTER_RESULT_VALUE = "supporter_result";

const SUPPORTER_BADGE_D = "linky-supporter";

export const supporterBadgeD = (badge: SupporterBadgeType): string =>
  badge === "generic" ? SUPPORTER_BADGE_D : `${SUPPORTER_BADGE_D}-${badge}`;

export const SUPPORTER_BADGE_DS: ReadonlyArray<string> =
  SupporterBadgeType.literals.map(supporterBadgeD);

const badgeOfD = (d: string | null): SupporterBadgeType | null =>
  SupporterBadgeType.literals.find((badge) => supporterBadgeD(badge) === d) ??
  null;

/** The `a` value naming `badge`'s definition by `issuer`. */
export const supporterBadgeAddress = (
  issuer: Pubkey,
  badge: SupporterBadgeType,
): string => `${BADGE_DEFINITION_KIND}:${issuer}:${supporterBadgeD(badge)}`;

const issuerPrefix = (issuer: Pubkey): string =>
  `${BADGE_DEFINITION_KIND}:${issuer}:`;

/** Any `linky-supporter*` definition by `issuer`, known badge or not. */
const isSupporterBadgeAddress = (address: string, issuer: Pubkey): boolean =>
  address.startsWith(`${issuerPrefix(issuer)}${SUPPORTER_BADGE_D}`);

const badgeOfAddress = (
  address: string,
  issuer: Pubkey,
): SupporterBadgeType | null =>
  address.startsWith(issuerPrefix(issuer))
    ? badgeOfD(address.slice(issuerPrefix(issuer).length))
    : null;

export const badgeDefinitionTemplate = (
  definition: BadgeDefinition,
): PlainEventTemplate => ({
  kind: BADGE_DEFINITION_KIND,
  tags: [
    ["d", supporterBadgeD(definition.badge)],
    ["name", definition.name],
    ["description", definition.description],
    ["image", definition.image],
    ["thumb", definition.thumb],
  ],
  content: "",
});

const decodeDefinitionFields = Schema.decodeUnknownOption(BadgeDefinition);

export const decodeBadgeDefinition = (
  event: SignedPlainEvent,
): BadgeDefinition | null =>
  Option.getOrNull(
    decodeDefinitionFields({
      badge: badgeOfD(firstTagValue(event.tags, "d")),
      name: firstTagValue(event.tags, "name"),
      description: firstTagValue(event.tags, "description"),
      image: firstTagValue(event.tags, "image"),
      thumb: firstTagValue(event.tags, "thumb"),
    }),
  );

export const awardTemplate = (
  issuer: Pubkey,
  badge: SupporterBadgeType,
  supporter: Pubkey,
): PlainEventTemplate => ({
  kind: BADGE_AWARD_KIND,
  tags: [
    ["a", supporterBadgeAddress(issuer, badge)],
    ["p", supporter],
  ],
  content: "",
});

/**
 * Verifies a kind 8 award: signature, author `issuer`, a `p` tag naming
 * `supporter`, and a single `a` tag naming a supporter badge of `issuer`.
 * How long the award counts is the caller's rule.
 */
export const verifySupporterAward = (
  raw: unknown,
  issuer: Pubkey,
  supporter: Pubkey,
): Either.Either<SupporterAward, SupporterAwardDropReason> =>
  Either.flatMap(
    decodeVerifiedPlainEvent(raw),
    (event): Either.Either<SupporterAward, SupporterAwardDropReason> => {
      if (event.kind !== BADGE_AWARD_KIND) return Either.left("not-an-award");
      if (event.pubkey !== issuer) return Either.left("wrong-issuer");
      if (!tagValues(event.tags, "p").includes(supporter))
        return Either.left("wrong-supporter");
      const address = singleTagValue(event.tags, "a");
      const badge = address === null ? null : badgeOfAddress(address, issuer);
      if (badge === null) return Either.left("not-a-supporter-badge");
      return Either.right(
        new SupporterAward({
          badge,
          supporter,
          awardedAt: event.created_at,
          event,
        }),
      );
    },
  );

const isEventId = Schema.is(EventId);

/** NIP-58 pairs: each `a` tag directly followed by an `e` tag. */
export const profileBadgeEntries = (
  tags: NostrTags,
): Array<ProfileBadgeEntry> =>
  tags.flatMap(([name, address], index) => {
    const next = tags[index + 1];
    const awardId = next?.[0] === "e" ? next[1] : undefined;
    return name === "a" && address !== undefined && isEventId(awardId)
      ? [new ProfileBadgeEntry({ address, awardId })]
      : [];
  });

/** The pairs pointing at a `linky-supporter*` definition of `issuer`. */
export const supporterBadgeEntries = (
  tags: NostrTags,
  issuer: Pubkey,
): Array<ProfileBadgeEntry> =>
  profileBadgeEntries(tags).filter((entry) =>
    isSupporterBadgeAddress(entry.address, issuer),
  );

/**
 * Drops every `issuer` supporter badge pair (its `a` tag and the `e` tag right
 * after it), keeps every other tag in order, and appends `award` when given.
 */
export const rewriteProfileBadgeTags = (
  tags: NostrTags,
  issuer: Pubkey,
  award: SupporterAward | null,
): NostrTags => {
  const kept: NostrTags = [];
  let skipAwardTag = false;
  for (const tag of tags) {
    const [name, value] = tag;
    if (skipAwardTag && name === "e") {
      skipAwardTag = false;
      continue;
    }
    skipAwardTag =
      name === "a" &&
      value !== undefined &&
      isSupporterBadgeAddress(value, issuer);
    if (!skipAwardTag) kept.push(tag);
  }
  return award === null
    ? kept
    : [
        ...kept,
        ["a", supporterBadgeAddress(issuer, award.badge)],
        ["e", award.event.id],
      ];
};

const SupporterResultContent = Schema.parseJson(SupporterResult);
const encodeSupporterResultContent = Schema.encodeSync(SupporterResultContent);
const decodeSupporterResultContent = Schema.decodeUnknownOption(
  SupporterResultContent,
);

export const encodeSupporterResultRumor = (
  draft: SupporterResultDraft,
  author: Pubkey,
  sentAt: UnixSeconds,
  clientId: ClientId,
): Rumor =>
  rumorWithHash({
    pubkey: author,
    created_at: sentAt,
    kind: SUPPORTER_RESULT_KIND,
    tags: [
      ["p", draft.to],
      ["client", clientId],
      ["linky", SUPPORTER_RESULT_VALUE],
      ["e", draft.tokenMessageId],
    ],
    content: encodeSupporterResultContent(draft.result),
  });

export const decodeSupporterResultRumor = (
  rumor: Rumor,
  me: Pubkey,
): Either.Either<SupporterResultInboxEvent, DropReason> => {
  const tokenMessageId = firstTagValue(rumor.tags, "e");
  const result = decodeSupporterResultContent(rumor.content);
  if (
    rumor.kind !== SUPPORTER_RESULT_KIND ||
    !rumor.tags.some(
      (tag) => tag[0] === "linky" && tag[1] === SUPPORTER_RESULT_VALUE,
    ) ||
    rumor.pubkey === me ||
    !tagValues(rumor.tags, "p").includes(me) ||
    !isRumorId(rumor.id) ||
    !isRumorId(tokenMessageId) ||
    Option.isNone(result)
  ) {
    return Either.left("invalid-supporter-result");
  }
  return Either.right(
    new SupporterResultReceived({
      resultId: rumor.id,
      from: rumor.pubkey,
      tokenMessageId,
      result: result.value,
      sentAt: rumor.created_at,
    }),
  );
};
