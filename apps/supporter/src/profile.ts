import {
  BadgeDefinition,
  ProfileMetadata,
  Profiles,
  RelayListEntry,
  RelayLists,
  RelayListsDraft,
  SupporterBadges,
  SupporterBadgeType,
} from "@linky-fit/linkstr";
import type {
  FetchedRelayLists,
  PublishedBadgeDefinition,
  Pubkey,
  RelayUrl,
} from "@linky-fit/linkstr";
import { Effect, Equal, Schedule } from "effect";
import { logInfo, logWarn } from "./log";

export const BOT_PROFILE = new ProfileMetadata({
  name: "Linky Bot",
  picture: "https://linky.fit/icon.svg",
  about:
    "Receives supporter payments for Linky and sends back supporter badges. Messages here are not read; write to the Linky contact instead.",
});

const badgeDefinition = (badge: SupporterBadgeType): BadgeDefinition => {
  const label =
    badge === "generic"
      ? ""
      : `${badge.charAt(0).toUpperCase()}${badge.slice(1)} `;
  const image = `https://linky.fit/badges/${badge === "generic" ? "supporter" : badge}.svg`;
  return new BadgeDefinition({
    badge,
    name: `Linky ${label}supporter`,
    description: `Supported Linky with a ${label}payment.`,
    image,
    thumb: image,
  });
};

export const BADGE_DEFINITIONS: ReadonlyArray<BadgeDefinition> =
  SupporterBadgeType.literals.map(badgeDefinition);

/** The wanted definitions the relays do not hold as they are. */
export const changedBadgeDefinitions = (
  published: ReadonlyArray<PublishedBadgeDefinition>,
  wanted: ReadonlyArray<BadgeDefinition> = BADGE_DEFINITIONS,
): ReadonlyArray<BadgeDefinition> =>
  wanted.filter(
    (definition) =>
      !published.some((entry) => Equal.equals(entry.definition, definition)),
  );

export const botRelayLists = (relays: ReadonlyArray<RelayUrl>) =>
  new RelayListsDraft({
    relays: relays.map((relay) => new RelayListEntry({ relay, marker: null })),
    dmRelays: relays,
  });

const definedFields = (profile: ProfileMetadata) =>
  JSON.stringify(
    Object.entries(profile)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

/** Decoded profiles spell absent fields as `undefined`, so compare what is set. */
export const sameProfile = (
  current: ProfileMetadata | undefined,
  desired: ProfileMetadata,
): boolean =>
  current !== undefined && definedFields(current) === definedFields(desired);

const sameSet = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && a.every((value) => b.includes(value));

export const relayListsMatch = (
  fetched: FetchedRelayLists,
  draft: RelayListsDraft,
): boolean =>
  fetched.relays !== null &&
  fetched.dmRelays !== null &&
  sameSet(
    fetched.relays.map((entry) => `${entry.relay} ${entry.marker}`),
    draft.relays.map((entry) => `${entry.relay} ${entry.marker}`),
  ) &&
  sameSet(fetched.dmRelays, draft.dmRelays);

/**
 * Publishes the profile, the relay lists and the badge definitions, each
 * unless the relays already hold it.
 */
export const publishBotEvents = (
  pubkey: Pubkey,
  relays: ReadonlyArray<RelayUrl>,
) =>
  Effect.gen(function* () {
    const profiles = yield* Profiles;
    const current = yield* profiles.fetchProfile(pubkey);
    if (sameProfile(current.profile?.metadata, BOT_PROFILE)) {
      yield* profiles.republishOwnProfile();
    } else {
      yield* profiles.publishProfile(BOT_PROFILE);
      logInfo("profile published");
    }

    const relayLists = yield* RelayLists;
    const draft = botRelayLists(relays);
    if (!relayListsMatch(yield* relayLists.fetchOwnRelayLists(), draft)) {
      yield* relayLists.publishRelayLists(draft);
      logInfo("relay lists published");
    }

    const badges = yield* SupporterBadges;
    for (const definition of changedBadgeDefinitions(
      yield* badges.fetchOwnBadgeDefinitions(),
    )) {
      yield* badges.publishBadgeDefinition(definition);
      logInfo(`badge definition published badge=${definition.badge}`);
    }
  }).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => logWarn("publishing Linky Bot events failed", error)),
    ),
    Effect.retry(
      Schedule.exponential("5 seconds").pipe(
        Schedule.union(Schedule.spaced("5 minutes")),
      ),
    ),
  );
