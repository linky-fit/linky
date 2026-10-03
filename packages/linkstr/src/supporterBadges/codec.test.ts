import { Either } from "effect";
import { finalizeEvent } from "nostr-tools";
import { ClientId, RumorId, UnixSeconds } from "../domain/primitives";
import type { Pubkey } from "../domain/primitives";
import { rumorWithHash } from "../internal/nostrEvent";
import type { NostrTags } from "../internal/nostrEvent";
import { signPlainEvent } from "../internal/plainEvent";
import { makeIdentity } from "../testing";
import {
  awardTemplate,
  badgeDefinitionTemplate,
  decodeBadgeDefinition,
  decodeSupporterResultRumor,
  encodeSupporterResultRumor,
  profileBadgeEntries,
  rewriteProfileBadgeTags,
  supporterBadgeAddress,
  verifySupporterAward,
} from "./codec";
import { BadgeDefinition, SupporterResultDraft } from "./domain";
import type { SupporterBadgeType, SupporterResult } from "./domain";

const bot = makeIdentity();
const supporter = makeIdentity();
const stranger = makeIdentity();

const awardedAt = UnixSeconds.make(1_790_000_000);
const tokenMessageId = RumorId.make("ab".repeat(32));

const signAward = (
  badge: SupporterBadgeType,
  issuer = bot,
  to: Pubkey = supporter.pubkey,
) =>
  signPlainEvent(
    awardTemplate(issuer.pubkey, badge, to),
    awardedAt,
    issuer.secretKey,
  );

const verifiedAward = (badge: SupporterBadgeType) =>
  Either.getOrThrow(
    verifySupporterAward(signAward(badge), bot.pubkey, supporter.pubkey),
  );

describe("verifySupporterAward", () => {
  it("accepts a tiered and a generic award of the issuer", () => {
    const gold = verifiedAward("gold");
    expect(gold.badge).toBe("gold");
    expect(gold.supporter).toBe(supporter.pubkey);
    expect(gold.awardedAt).toBe(awardedAt);
    expect(gold.event.tags).toEqual([
      ["a", `30009:${bot.pubkey}:linky-supporter-gold`],
      ["p", supporter.pubkey],
    ]);
    expect(verifiedAward("generic").event.tags[0]).toEqual([
      "a",
      `30009:${bot.pubkey}:linky-supporter`,
    ]);
  });

  const rejected = (raw: unknown, to: Pubkey = supporter.pubkey) =>
    Either.flip(verifySupporterAward(raw, bot.pubkey, to)).pipe(
      Either.getOrThrow,
    );

  it("names why an award does not count", () => {
    expect(rejected({ kind: 8 })).toBe("malformed-event");
    expect(rejected({ ...signAward("gold"), sig: "00".repeat(64) })).toBe(
      "invalid-signature",
    );
    expect(rejected(signAward("gold", stranger))).toBe("wrong-issuer");
    expect(rejected(signAward("gold"), stranger.pubkey)).toBe(
      "wrong-supporter",
    );
    expect(
      rejected(
        finalizeEvent(
          {
            kind: 1,
            tags: [],
            content: "",
            created_at: awardedAt,
          },
          bot.secretKey,
        ),
      ),
    ).toBe("not-an-award");
    const otherBadge = (a: string) =>
      finalizeEvent(
        {
          kind: 8,
          tags: [
            ["a", a],
            ["p", supporter.pubkey],
          ],
          content: "",
          created_at: awardedAt,
        },
        bot.secretKey,
      );
    expect(rejected(otherBadge(`30009:${bot.pubkey}:early-adopter`))).toBe(
      "not-a-supporter-badge",
    );
    expect(
      rejected(otherBadge(`30009:${stranger.pubkey}:linky-supporter-gold`)),
    ).toBe("not-a-supporter-badge");
  });
});

describe("badge definitions", () => {
  it("round-trips a definition through its kind 30009 tags", () => {
    const definition = new BadgeDefinition({
      badge: "diamond",
      name: "Diamond supporter",
      description: "Supports Linky",
      image: "https://linky.fit/badges/diamond.png",
      thumb: "https://linky.fit/badges/diamond-thumb.png",
    });
    const event = signPlainEvent(
      badgeDefinitionTemplate(definition),
      awardedAt,
      bot.secretKey,
    );
    expect(event.kind).toBe(30009);
    expect(event.tags[0]).toEqual(["d", "linky-supporter-diamond"]);
    expect(decodeBadgeDefinition(event)).toEqual(definition);
  });
});

describe("profile badges rewrite", () => {
  const foreign: NostrTags = [
    ["a", `30009:${stranger.pubkey}:bravery`],
    ["e", "11".repeat(32)],
  ];
  const existing: NostrTags = [
    ["d", "profile_badges"],
    ...foreign,
    ["a", supporterBadgeAddress(bot.pubkey, "bronze")],
    ["e", "22".repeat(32)],
    ["a", `30009:${bot.pubkey}:linky-supporter-platinum`],
    ["a", `30009:${bot.pubkey}:honorary`],
    ["e", "33".repeat(32)],
  ];

  it("replaces the issuer's supporter badges and keeps every other entry", () => {
    const gold = verifiedAward("gold");
    expect(rewriteProfileBadgeTags(existing, bot.pubkey, gold)).toEqual([
      ["d", "profile_badges"],
      ...foreign,
      ["a", `30009:${bot.pubkey}:honorary`],
      ["e", "33".repeat(32)],
      ["a", `30009:${bot.pubkey}:linky-supporter-gold`],
      ["e", gold.event.id],
    ]);
  });

  it("removes them all when hiding", () => {
    expect(rewriteProfileBadgeTags(existing, bot.pubkey, null)).toEqual([
      ["d", "profile_badges"],
      ...foreign,
      ["a", `30009:${bot.pubkey}:honorary`],
      ["e", "33".repeat(32)],
    ]);
  });

  it("reads only complete a + e pairs", () => {
    expect(profileBadgeEntries(existing).map(({ address }) => address)).toEqual(
      [
        `30009:${stranger.pubkey}:bravery`,
        supporterBadgeAddress(bot.pubkey, "bronze"),
        `30009:${bot.pubkey}:honorary`,
      ],
    );
  });
});

describe("supporter result rumor", () => {
  const encode = (result: SupporterResult, author = bot) =>
    encodeSupporterResultRumor(
      new SupporterResultDraft({
        to: supporter.pubkey,
        tokenMessageId,
        result,
      }),
      author.pubkey,
      awardedAt,
      ClientId.make("result-client"),
    );

  it("carries the token message id and decodes each status", () => {
    const issued: SupporterResult = {
      status: "issued",
      tier: "gold",
      awards: [signAward("gold"), signAward("generic")],
    };
    const rumor = encode(issued);
    expect(rumor.kind).toBe(24137);
    expect(rumor.tags).toEqual([
      ["p", supporter.pubkey],
      ["client", "result-client"],
      ["linky", "supporter_result"],
      ["e", tokenMessageId],
    ]);
    expect(JSON.parse(rumor.content)).toEqual(
      JSON.parse(JSON.stringify(issued)),
    );

    for (const result of [
      issued,
      { status: "thanks" },
      { status: "refused", reason: "mint_not_accepted" },
    ] satisfies Array<SupporterResult>) {
      const decoded = Either.getOrThrow(
        decodeSupporterResultRumor(encode(result), supporter.pubkey),
      );
      expect(decoded).toEqual(
        expect.objectContaining({
          _tag: "SupporterResultReceived",
          from: bot.pubkey,
          tokenMessageId,
          result,
          sentAt: awardedAt,
        }),
      );
    }
  });

  it("drops a result it cannot trust", () => {
    const withContent = (content: string) =>
      rumorWithHash({ ...encode({ status: "thanks" }), content });
    const withoutTokenMessage = rumorWithHash({
      ...encode({ status: "thanks" }),
      tags: [
        ["p", supporter.pubkey],
        ["linky", "supporter_result"],
      ],
    });
    for (const rumor of [
      withContent('{"status":"pending"}'),
      withContent('{"status":"refused","reason":"broke"}'),
      withContent("thanks"),
      withoutTokenMessage,
      encode({ status: "thanks" }, supporter),
    ]) {
      expect(decodeSupporterResultRumor(rumor, supporter.pubkey)).toEqual(
        Either.left("invalid-supporter-result"),
      );
    }
    expect(
      decodeSupporterResultRumor(encode({ status: "thanks" }), stranger.pubkey),
    ).toEqual(Either.left("invalid-supporter-result"));
  });
});
