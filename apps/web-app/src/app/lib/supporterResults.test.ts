import {
  Pubkey,
  SignedPlainEvent,
  supporterBadgeAddress,
  type SupporterBadgeType,
  type SupporterResultReceived,
} from "@linky-fit/linkstr";
import { PositiveInt } from "@linky-fit/linksync";
import { Schema } from "effect";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { describe, expect, it } from "vitest";
import {
  encodeAwardEvent,
  profileBadgeAward,
  readSupporterResult,
  supporterResultNotice,
} from "./supporterResults";

const botKey = generateSecretKey();
const bot = Pubkey.make(getPublicKey(botKey));
const me = Pubkey.make(getPublicKey(generateSecretKey()));
const DAY = 24 * 60 * 60;
const NOW = 1_800_000_000;

const signAward = (
  badge: SupporterBadgeType,
  awardedAt: number,
  signer = botKey,
): SignedPlainEvent =>
  Schema.decodeUnknownSync(SignedPlainEvent)(
    finalizeEvent(
      {
        kind: 8,
        created_at: awardedAt,
        tags: [
          ["a", supporterBadgeAddress(bot, badge)],
          ["p", me],
        ],
        content: "",
      },
      signer,
    ),
  );

const record = (badge: SupporterBadgeType, awardedAt: number) => ({
  eventJson: encodeAwardEvent(signAward(badge, awardedAt)),
  badge,
  awardedAtSec: PositiveInt.orThrow(awardedAt),
});

const result = (
  value: SupporterResultReceived["result"],
): Pick<SupporterResultReceived, "result"> => ({ result: value });

describe("readSupporterResult", () => {
  it("keeps the awards that verify and names the ones that do not", () => {
    const outcome = readSupporterResult(
      result({
        status: "issued",
        tier: "gold",
        awards: [
          signAward("gold", NOW),
          signAward("generic", NOW, generateSecretKey()),
        ],
      }),
      bot,
      me,
    );
    expect(outcome).toMatchObject({
      kind: "issued",
      tier: "gold",
      awards: [{ badge: "gold" }],
      dropped: ["wrong-issuer"],
    });
    expect(supporterResultNotice(outcome)).toBe("supporterResultIssued");
  });

  it("says when no award of an issued result verifies", () => {
    const outcome = readSupporterResult(
      result({
        status: "issued",
        tier: "bronze",
        awards: [signAward("bronze", NOW), signAward("generic", NOW)],
      }),
      bot,
      Pubkey.make(getPublicKey(generateSecretKey())),
    );
    expect(supporterResultNotice(outcome)).toBe("supporterResultUnverified");
  });

  it("maps thanks and refusals to their notices", () => {
    expect(
      supporterResultNotice(
        readSupporterResult(result({ status: "thanks" }), bot, me),
      ),
    ).toBe("supporterResultThanks");
    expect(
      readSupporterResult(
        result({ status: "refused", reason: "mint_not_accepted" }),
        bot,
        me,
      ),
    ).toEqual({ kind: "refused", reason: "mint_not_accepted" });
    expect(
      supporterResultNotice({ kind: "refused", reason: "token_spent" }),
    ).toBe("supporterResultTokenSpent");
  });
});

describe("profileBadgeAward", () => {
  const context = { issuer: bot, me, nowSec: NOW };

  it("shows the newest valid tiered award, whatever its tier", () => {
    const records = [
      record("gold", NOW - 10 * DAY),
      record("bronze", NOW - DAY),
      record("gold", NOW - 5 * DAY),
      record("generic", NOW),
    ];
    const award = profileBadgeAward(records, "tier", context);
    expect(award?.badge).toBe("bronze");
    expect(award?.awardedAt).toBe(NOW - DAY);
  });

  it("shows the newest valid generic award, or none", () => {
    const records = [
      record("generic", NOW - 3 * DAY),
      record("generic", NOW - DAY),
      record("gold", NOW),
    ];
    expect(profileBadgeAward(records, "generic", context)?.awardedAt).toBe(
      NOW - DAY,
    );
    expect(profileBadgeAward(records, "hide", context)).toBeNull();
  });

  it("shows none once every award of the kind lapsed", () => {
    const records = [record("silver", NOW - 3_600)];
    expect(
      profileBadgeAward(records, "tier", { ...context, validitySeconds: 60 }),
    ).toBeNull();
  });

  it("skips a stored award that no longer verifies", () => {
    const forged = { ...record("gold", NOW), eventJson: "{}" };
    const silver = record("silver", NOW - DAY);
    expect(profileBadgeAward([forged, silver], "tier", context)?.badge).toBe(
      "silver",
    );
  });
});
