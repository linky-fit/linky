import { Effect, Either, Exit, Layer } from "effect";
import { finalizeEvent, verifyEvent } from "nostr-tools";
import type { Event as NostrToolsEvent, Filter } from "nostr-tools";
import { RelayUrl, UnixSeconds } from "../domain/primitives";
import type { SignedPlainEvent } from "../internal/nostrEvent";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import type { LinkstrIdentityService } from "../services/LinkstrIdentity";
import { RelayUnreachable } from "../services/NostrTransport";
import type {
  NostrTransport,
  NostrTransportService,
} from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import { makeIdentity, stubPlainTransport } from "../testing";
import { supporterBadgeAddress, verifySupporterAward } from "./codec";
import { BadgeDefinition } from "./domain";
import { SupporterBadges } from "./SupporterBadges";

const bot = makeIdentity();
const supporter = makeIdentity();
const stranger = makeIdentity();

const relayA = RelayUrl.make("wss://relay-a.test");
const relayB = RelayUrl.make("wss://relay-b.test");

const awardedAt = UnixSeconds.make(1_790_000_000);

const runAs = <A, E>(
  identity: LinkstrIdentityService,
  transport: Layer.Layer<NostrTransport>,
  program: Effect.Effect<A, E, SupporterBadges>,
  readRelays: ReadonlyArray<RelayUrl> = [relayA],
): Promise<Exit.Exit<A, E>> =>
  Effect.runPromiseExit(
    program.pipe(
      Effect.provide(
        SupporterBadges.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              LinkstrIdentity.fromSecretKey(identity.secretKey),
              RelayPolicy.fixed({ readRelays, writeRelays: [relayA] }),
              transport,
            ),
          ),
        ),
      ),
    ),
  );

const fetching = (
  published: Array<SignedPlainEvent>,
  fetch: NostrTransportService["fetch"],
) => stubPlainTransport(published, () => true, { fetch });

const definition = (badge: "gold" | "generic", name: string) =>
  new BadgeDefinition({
    badge,
    name,
    description: "Supports Linky",
    image: `https://linky.fit/badges/${badge}.png`,
    thumb: `https://linky.fit/badges/${badge}-thumb.png`,
  });

describe("SupporterBadges definitions", () => {
  it("publishes a kind 30009 definition", async () => {
    const published: Array<SignedPlainEvent> = [];
    const exit = await runAs(
      bot,
      stubPlainTransport(published),
      Effect.flatMap(SupporterBadges, (badges) =>
        badges.publishBadgeDefinition(definition("gold", "Gold supporter")),
      ),
    );
    assert(Exit.isSuccess(exit));
    expect(published[0]?.kind).toBe(30009);
    expect(published[0]?.tags).toEqual([
      ["d", "linky-supporter-gold"],
      ["name", "Gold supporter"],
      ["description", "Supports Linky"],
      ["image", "https://linky.fit/badges/gold.png"],
      ["thumb", "https://linky.fit/badges/gold-thumb.png"],
    ]);
  });

  it("fetches the newest own definition per badge, leaving out a malformed newest one", async () => {
    const asked: Array<Filter> = [];
    const signed = (tags: Array<Array<string>>, createdAt: number) =>
      finalizeEvent(
        { kind: 30009, tags, content: "", created_at: createdAt },
        bot.secretKey,
      );
    const tagsOf = ({
      badge,
      name,
      description,
      image,
      thumb,
    }: BadgeDefinition) => [
      [
        "d",
        badge === "generic" ? "linky-supporter" : `linky-supporter-${badge}`,
      ],
      ["name", name],
      ["description", description],
      ["image", image],
      ["thumb", thumb],
    ];
    const exit = await runAs(
      bot,
      fetching([], (_relay, filter) =>
        Effect.sync(() => {
          asked.push(filter);
          return [
            signed(tagsOf(definition("gold", "Old gold")), 100),
            signed(tagsOf(definition("gold", "Gold supporter")), 200),
            signed([["d", "linky-supporter"]], 300),
            signed(tagsOf(definition("generic", "Supporter")), 200),
          ];
        }),
      ),
      Effect.flatMap(SupporterBadges, (badges) =>
        badges.fetchOwnBadgeDefinitions(),
      ),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.map(({ definition }) => definition)).toEqual([
      definition("gold", "Gold supporter"),
    ]);
    expect(asked[0]).toEqual(
      expect.objectContaining({ kinds: [30009], authors: [bot.pubkey] }),
    );
  });
});

describe("SupporterBadges.signAwards", () => {
  it("signs a tiered and a generic award dated at the start, without expiration", async () => {
    const exit = await runAs(
      bot,
      stubPlainTransport([]),
      Effect.flatMap(SupporterBadges, (badges) =>
        badges.signAwards(supporter.pubkey, "silver", awardedAt),
      ),
    );
    assert(Exit.isSuccess(exit));
    const [tiered, generic] = exit.value;
    for (const award of [tiered, generic]) {
      expect(verifyEvent(award)).toBe(true);
      expect(award.created_at).toBe(awardedAt);
      expect(award.tags.some(([name]) => name === "expiration")).toBe(false);
    }
    expect(
      Either.map(
        verifySupporterAward(tiered, bot.pubkey, supporter.pubkey),
        ({ badge }) => badge,
      ),
    ).toEqual(Either.right("silver"));
    expect(
      Either.map(
        verifySupporterAward(generic, bot.pubkey, supporter.pubkey),
        ({ badge }) => badge,
      ),
    ).toEqual(Either.right("generic"));
  });
});

describe("SupporterBadges profile badges", () => {
  const award = (badge: "gold" | "generic") =>
    Either.getOrThrow(
      verifySupporterAward(
        finalizeEvent(
          {
            kind: 8,
            tags: [
              ["a", supporterBadgeAddress(bot.pubkey, badge)],
              ["p", supporter.pubkey],
            ],
            content: "",
            created_at: awardedAt,
          },
          bot.secretKey,
        ),
        bot.pubkey,
        supporter.pubkey,
      ),
    );
  const foreign = [
    ["a", `30009:${stranger.pubkey}:bravery`],
    ["e", "11".repeat(32)],
  ];
  const profileBadges = (tags: Array<Array<string>>, createdAt: number) =>
    finalizeEvent(
      {
        kind: 30008,
        tags: [["d", "profile_badges"], ...tags],
        content: "my badges",
        created_at: createdAt,
      },
      supporter.secretKey,
    );
  const stored = (events: Array<NostrToolsEvent>) =>
    fetching([], () => Effect.succeed(events));

  it("fetches the newest own profile badges as a + e pairs", async () => {
    const exit = await runAs(
      supporter,
      stored([profileBadges([], 100), profileBadges(foreign, 200)]),
      Effect.flatMap(SupporterBadges, (badges) =>
        badges.fetchOwnProfileBadges(),
      ),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value?.createdAt).toBe(200);
    expect(exit.value?.entries).toEqual([
      expect.objectContaining({
        address: `30009:${stranger.pubkey}:bravery`,
        awardId: "11".repeat(32),
      }),
    ]);
  });

  it("publishes the award, then rewrites the Linky entries and keeps the rest", async () => {
    const published: Array<SignedPlainEvent> = [];
    const gold = award("gold");
    const exit = await runAs(
      supporter,
      fetching(published, () =>
        Effect.succeed([
          profileBadges(
            [
              ...foreign,
              ["a", supporterBadgeAddress(bot.pubkey, "generic")],
              ["e", "22".repeat(32)],
            ],
            100,
          ),
        ]),
      ),
      Effect.flatMap(SupporterBadges, (badges) =>
        badges.publishProfileBadge(bot.pubkey, gold),
      ),
    );
    assert(Exit.isSuccess(exit));
    expect(published.map(({ id }) => id)).toEqual([
      gold.event.id,
      exit.value.eventId,
    ]);
    expect(published[1]?.content).toBe("my badges");
    expect(published[1]?.tags).toEqual([
      ["d", "profile_badges"],
      ...foreign,
      ["a", supporterBadgeAddress(bot.pubkey, "gold")],
      ["e", gold.event.id],
    ]);
  });

  it("removes the Linky entries when hiding, starting a fresh list when none exists", async () => {
    const published: Array<SignedPlainEvent> = [];
    const exit = await runAs(
      supporter,
      fetching(published, () => Effect.succeed([])),
      Effect.flatMap(SupporterBadges, (badges) =>
        badges.publishProfileBadge(bot.pubkey, null),
      ),
    );
    assert(Exit.isSuccess(exit));
    expect(published).toHaveLength(1);
    expect(published[0]?.kind).toBe(30008);
    expect(published[0]?.tags).toEqual([["d", "profile_badges"]]);
  });

  it("publishes nothing while a silent relay may hold the only list", async () => {
    const published: Array<SignedPlainEvent> = [];
    const exit = await runAs(
      supporter,
      fetching(published, (relay) =>
        relay === relayB
          ? Effect.fail(new RelayUnreachable({ relay, detail: "timed out" }))
          : Effect.succeed([]),
      ),
      Effect.flatMap(SupporterBadges, (badges) =>
        badges.publishProfileBadge(bot.pubkey, award("generic")),
      ),
      [relayA, relayB],
    );
    expect(exit).toEqual(
      Exit.fail(expect.objectContaining({ _tag: "SomeRelaysUnanswered" })),
    );
    expect(published).toEqual([]);
  });
});
