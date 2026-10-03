import {
  SignedPlainEvent,
  verifySupporterAward,
  type Pubkey,
  type SupporterAward,
  type SupporterAwardDropReason,
  type SupporterRefusalReason,
  type SupporterResultReceived,
  type SupporterTier,
} from "@linky-fit/linkstr";
import type { SettingValues, SupporterAwardRecord } from "@linky-fit/linksync";
import { isSupporterAwardValid } from "@linky-fit/supporter";
import { Either, Schema } from "effect";
import type { I18nKey } from "../../i18n";

export type SupporterResultOutcome =
  | {
      readonly kind: "issued";
      readonly tier: SupporterTier;
      /** The awards that verify against Linky Bot and the user. */
      readonly awards: ReadonlyArray<SupporterAward>;
      readonly dropped: ReadonlyArray<SupporterAwardDropReason>;
    }
  | { readonly kind: "thanks" }
  | { readonly kind: "refused"; readonly reason: SupporterRefusalReason };

/** What a result from Linky Bot (`issuer`) means for the user (`me`). */
export const readSupporterResult = (
  { result }: Pick<SupporterResultReceived, "result">,
  issuer: Pubkey,
  me: Pubkey,
): SupporterResultOutcome => {
  if (result.status === "thanks") return { kind: "thanks" };
  if (result.status === "refused") {
    return { kind: "refused", reason: result.reason };
  }
  const checked = result.awards.map((award) =>
    verifySupporterAward(award, issuer, me),
  );
  return {
    kind: "issued",
    tier: result.tier,
    awards: checked.flatMap((award) =>
      Either.isRight(award) ? [award.right] : [],
    ),
    dropped: checked.flatMap((award) =>
      Either.isLeft(award) ? [award.left] : [],
    ),
  };
};

const REFUSAL_NOTICES = {
  mint_not_accepted: "supporterResultMintNotAccepted",
  token_spent: "supporterResultTokenSpent",
  invalid_token: "supporterResultInvalidToken",
} as const satisfies Record<SupporterRefusalReason, I18nKey>;

/** The line the conversation with Linky Bot shows for a result. */
export const supporterResultNotice = (
  outcome: SupporterResultOutcome,
): I18nKey => {
  switch (outcome.kind) {
    case "issued":
      return outcome.awards.length > 0
        ? "supporterResultIssued"
        : "supporterResultUnverified";
    case "thanks":
      return "supporterResultThanks";
    case "refused":
      return REFUSAL_NOTICES[outcome.reason];
  }
};

const AwardEventJson = Schema.parseJson(SignedPlainEvent);

/** The signed award as the `eventJson` column stores it. */
export const encodeAwardEvent: (event: SignedPlainEvent) => string =
  Schema.encodeSync(AwardEventJson);

const decodeAwardEvent = Schema.decodeUnknownEither(AwardEventJson);

interface ProfileBadgeContext {
  readonly issuer: Pubkey;
  readonly me: Pubkey;
  readonly nowSec: number;
  readonly validitySeconds?: number | undefined;
}

/**
 * The award the profile shows for `display`: the newest valid award of the
 * chosen kind; null shows none.
 */
export const profileBadgeAward = (
  records: ReadonlyArray<
    Pick<SupporterAwardRecord, "awardedAtSec" | "badge" | "eventJson">
  >,
  display: SettingValues["supporterBadgeDisplay"],
  { issuer, me, nowSec, validitySeconds }: ProfileBadgeContext,
): SupporterAward | null => {
  if (display === "hide") return null;
  const candidates = records
    .filter(
      (record) =>
        (record.badge === "generic") === (display === "generic") &&
        isSupporterAwardValid(record.awardedAtSec, nowSec, validitySeconds),
    )
    .sort((a, b) => b.awardedAtSec - a.awardedAtSec);
  for (const record of candidates) {
    const event = decodeAwardEvent(record.eventJson);
    if (Either.isLeft(event)) continue;
    const award = verifySupporterAward(event.right, issuer, me);
    if (Either.isRight(award)) return award.right;
  }
  return null;
};
