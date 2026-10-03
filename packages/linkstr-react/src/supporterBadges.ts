import { SupporterBadges } from "@linky-fit/linkstr";
import type {
  BadgeDefinition,
  Pubkey,
  SupporterAward,
  SupporterResultDraft,
  SupporterTier,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { Effect } from "effect";
import { linkstrRuntimeAtom } from "./runtime";

export const publishBadgeDefinitionAtom =
  linkstrRuntimeAtom.fn<BadgeDefinition>()((definition) =>
    Effect.flatMap(SupporterBadges, (badges) =>
      badges.publishBadgeDefinition(definition),
    ),
  );

export const fetchOwnBadgeDefinitionsAtom = linkstrRuntimeAtom.fn<void>()(() =>
  Effect.flatMap(SupporterBadges, (badges) =>
    badges.fetchOwnBadgeDefinitions(),
  ),
);

export const signSupporterAwardsAtom = linkstrRuntimeAtom.fn<{
  readonly supporter: Pubkey;
  readonly tier: SupporterTier;
  readonly awardedAt: UnixSeconds;
}>()(({ supporter, tier, awardedAt }) =>
  Effect.flatMap(SupporterBadges, (badges) =>
    badges.signAwards(supporter, tier, awardedAt),
  ),
);

export const sendSupporterResultAtom =
  linkstrRuntimeAtom.fn<SupporterResultDraft>()((draft) =>
    Effect.flatMap(SupporterBadges, (badges) => badges.sendResult(draft)),
  );

export const fetchOwnProfileBadgesAtom = linkstrRuntimeAtom.fn<void>()(() =>
  Effect.flatMap(SupporterBadges, (badges) => badges.fetchOwnProfileBadges()),
);

export const publishProfileBadgeAtom = linkstrRuntimeAtom.fn<{
  readonly issuer: Pubkey;
  readonly award: SupporterAward | null;
}>()(({ issuer, award }) =>
  Effect.flatMap(SupporterBadges, (badges) =>
    badges.publishProfileBadge(issuer, award),
  ),
);
