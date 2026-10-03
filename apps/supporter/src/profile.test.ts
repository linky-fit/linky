import {
  BadgeDefinition,
  EventId,
  FetchedRelayLists,
  PublishedBadgeDefinition,
  ProfileMetadata,
  RelayListEntry,
  RelayUrl,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { describe, expect, it } from "bun:test";
import {
  BADGE_DEFINITIONS,
  BOT_PROFILE,
  changedBadgeDefinitions,
  botRelayLists,
  relayListsMatch,
  sameProfile,
} from "./profile";

const relayA = RelayUrl.make("wss://a.example");
const relayB = RelayUrl.make("wss://b.example");

const fetched = (
  relays: ReadonlyArray<RelayListEntry> | null,
  dmRelays: ReadonlyArray<RelayUrl> | null,
) =>
  new FetchedRelayLists({
    relays,
    relaysUpdatedAt: relays === null ? null : UnixSeconds.make(1),
    dmRelays,
    dmRelaysUpdatedAt: dmRelays === null ? null : UnixSeconds.make(1),
  });

describe("bot profile", () => {
  it("compares the fields a profile sets, so an unchanged one is not republished", () => {
    const fetched = new ProfileMetadata({
      ...BOT_PROFILE,
      displayName: undefined,
      lud16: undefined,
    });
    expect(sameProfile(fetched, BOT_PROFILE)).toBe(true);
    expect(
      sameProfile(
        new ProfileMetadata({ ...BOT_PROFILE, about: "old" }),
        BOT_PROFILE,
      ),
    ).toBe(false);
    expect(
      sameProfile(
        new ProfileMetadata({ ...BOT_PROFILE, lud16: "a@b.c" }),
        BOT_PROFILE,
      ),
    ).toBe(false);
    expect(sameProfile(undefined, BOT_PROFILE)).toBe(false);
  });

  it("matches relay lists regardless of order", () => {
    const draft = botRelayLists([relayA, relayB]);
    const entries = [relayB, relayA].map(
      (relay) => new RelayListEntry({ relay, marker: null }),
    );
    expect(relayListsMatch(fetched(entries, [relayB, relayA]), draft)).toBe(
      true,
    );
    expect(relayListsMatch(fetched(entries, [relayA]), draft)).toBe(false);
    expect(relayListsMatch(fetched(null, [relayA, relayB]), draft)).toBe(false);
    expect(
      relayListsMatch(
        fetched(
          [
            new RelayListEntry({ relay: relayA, marker: "read" }),
            new RelayListEntry({ relay: relayB, marker: null }),
          ],
          [relayA, relayB],
        ),
        draft,
      ),
    ).toBe(false);
  });
});

describe("badge definitions", () => {
  const published = (definition: (typeof BADGE_DEFINITIONS)[number]) =>
    new PublishedBadgeDefinition({
      eventId: EventId.make("f".repeat(64)),
      createdAt: UnixSeconds.make(1),
      definition,
    });

  it("defines all five badges with their linky.fit images", () => {
    expect(
      BADGE_DEFINITIONS.map(({ badge, name, image, thumb }) => [
        badge,
        name,
        image === thumb ? image : "thumb differs",
      ]),
    ).toEqual([
      [
        "bronze",
        "Linky Bronze supporter",
        "https://linky.fit/badges/bronze.svg",
      ],
      [
        "silver",
        "Linky Silver supporter",
        "https://linky.fit/badges/silver.svg",
      ],
      ["gold", "Linky Gold supporter", "https://linky.fit/badges/gold.svg"],
      [
        "diamond",
        "Linky Diamond supporter",
        "https://linky.fit/badges/diamond.svg",
      ],
      ["generic", "Linky supporter", "https://linky.fit/badges/supporter.svg"],
    ]);
  });

  it("republishes only the definitions that are missing or changed", () => {
    const [bronze, silver, ...rest] = BADGE_DEFINITIONS;
    if (bronze === undefined || silver === undefined)
      throw new Error("missing definitions");
    const relays = [
      published(new BadgeDefinition({ ...bronze })),
      published(new BadgeDefinition({ ...silver, description: "old" })),
      ...rest.map(published),
    ];
    expect(changedBadgeDefinitions(relays)).toEqual([silver]);
    expect(changedBadgeDefinitions([])).toEqual(BADGE_DEFINITIONS);
  });
});
