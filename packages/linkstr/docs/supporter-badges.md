# Supporter badges

`SupporterBadges` covers NIP-58 badges that an issuer awards to the people who pay it, and the gift-wrapped supporter result that delivers them. Three parties use it:

- the **issuer**, an identity that receives payments, publishes the badge definitions and signs awards;
- the **supporter**, who receives the awards and may show one in their profile badges;
- **contacts**, who read the supporter's profile badges through `ProfileWatch` and verify each award against the issuer.

Linkstr does not know which identity is the issuer: every call that checks or rewrites badges takes the issuer pubkey as a parameter. It also does not decide how long an award counts. A verified award carries `awardedAt` (the event's `created_at`); applying a validity window is up to you. In React use the fn atoms listed in [react.md](./react.md#call-an-operation).

## Badge types

`SupporterTier` is `bronze`, `silver`, `gold` or `diamond`. `SupporterBadgeType` adds `generic`, the badge that names no tier. Each type has one definition, addressed by its `d` tag:

| `SupporterBadgeType` | `d`                       |
| -------------------- | ------------------------- |
| `bronze`             | `linky-supporter-bronze`  |
| `silver`             | `linky-supporter-silver`  |
| `gold`               | `linky-supporter-gold`    |
| `diamond`            | `linky-supporter-diamond` |
| `generic`            | `linky-supporter`         |

`supporterBadgeAddress(issuer, badge)` returns the `a` value `30009:<issuer>:<d>` that awards and profile badges use.

## Issuer: badge definitions

`publishBadgeDefinition(definition)` publishes one kind 30009 definition and returns a `PlainEventReceipt`. `fetchOwnBadgeDefinitions()` asks every read and write relay for your definitions and returns the newest one per badge as `PublishedBadgeDefinition`. A badge whose newest definition is malformed is left out, so it reads as missing. Compare the result with what you want published and republish only the difference:

```ts
import { Effect, Equal } from "effect";
import { SupporterBadges, type BadgeDefinition } from "@linky-fit/linkstr";

const syncDefinitions = (wanted: ReadonlyArray<BadgeDefinition>) =>
  Effect.gen(function* () {
    const badges = yield* SupporterBadges;
    const published = yield* badges.fetchOwnBadgeDefinitions();
    for (const definition of wanted) {
      const current = published.find(
        (entry) => entry.definition.badge === definition.badge,
      );
      if (
        current === undefined ||
        !Equal.equals(current.definition, definition)
      )
        yield* badges.publishBadgeDefinition(definition);
    }
  });
```

## Issuer: awards and the supporter result

`signAwards(supporter, tier, awardedAt)` signs two kind 8 awards with your identity, the tiered one first and the generic one second, both dated `awardedAt`. It publishes nothing; the supporter decides whether to publish one.

The answer to a payment is a `SupporterResultDraft`: the supporter, the rumor id of the token message it answers (`tokenMessageId`), and a `SupporterResult`:

| `status`  | Other fields                                                  | Meaning                        |
| --------- | ------------------------------------------------------------- | ------------------------------ |
| `issued`  | `tier`, `awards` (the tiered and the generic kind 8)          | the payment reached `tier`     |
| `thanks`  | none                                                          | received, but below every tier |
| `refused` | `reason`: `mint_not_accepted`, `token_spent`, `invalid_token` | nothing was received           |

Queue it through the outbox, which retries until a relay accepts the wrap ([outbox.md](./outbox.md)):

```ts
import { Effect } from "effect";
import {
  Outbox,
  OutboxRef,
  SupporterBadges,
  SupporterResultDraft,
  UnixSeconds,
  type Pubkey,
  type RumorId,
  type SupporterTier,
} from "@linky-fit/linkstr";

const answerPayment = (
  supporter: Pubkey,
  tokenMessageId: RumorId,
  tier: SupporterTier,
) =>
  Effect.gen(function* () {
    const badges = yield* SupporterBadges;
    const outbox = yield* Outbox;
    const awards = yield* badges.signAwards(
      supporter,
      tier,
      UnixSeconds.make(Math.floor(Date.now() / 1000)),
    );
    return yield* outbox.enqueue(
      {
        _tag: "supporterResult",
        draft: new SupporterResultDraft({
          to: supporter,
          tokenMessageId,
          result: { status: "issued", tier, awards },
        }),
      },
      OutboxRef.make(`payment:${tokenMessageId}`),
    );
  });
```

`sendResult(draft)` sends the same result once, directly, and fails with `WrapNotDelivered` when no relay accepted it. Either way the result is wrapped once, to the supporter, push-marked, with no self copy; the receipt is a `SupporterResultReceipt`.

## Supporter: receiving a result

The result arrives on the inbox as `SupporterResultReceived` with `from`, `resultId`, `tokenMessageId`, `result` and `sentAt` ([inbox.md](./inbox.md)). The inbox checks only the shape of the awards. Check `from` against the issuer you trust, then verify each award before you keep it:

```ts
import { Either } from "effect";
import {
  verifySupporterAward,
  type Pubkey,
  type SupporterAward,
  type SupporterResultReceived,
} from "@linky-fit/linkstr";

const awardsFrom = (
  event: SupporterResultReceived,
  issuer: Pubkey,
  me: Pubkey,
): Array<SupporterAward> =>
  event.from !== issuer || event.result.status !== "issued"
    ? []
    : event.result.awards.flatMap((award) =>
        Either.match(verifySupporterAward(award, issuer, me), {
          onLeft: () => [],
          onRight: (verified) => [verified],
        }),
      );
```

`verifySupporterAward(event, issuer, supporter)` is pure. It checks the signature, that `issuer` signed the event, that a `p` tag names `supporter`, and that the single `a` tag names a supporter badge of `issuer`. It returns a `SupporterAward` (`badge`, `supporter`, `awardedAt` and the signed `event`) or a `SupporterAwardDropReason`: `malformed-event`, `invalid-signature`, `not-an-award`, `wrong-issuer`, `wrong-supporter` or `not-a-supporter-badge`.

Drop reason on the inbox: `invalid-supporter-result` (missing `linky` tag, not p-tagged to you, authored by you, missing or malformed `e` tag, or content that matches no `SupporterResult`).

## Supporter: showing a badge

`publishProfileBadge(issuer, award)` shows one award in your NIP-58 profile badges, or hides them all when `award` is `null`. It:

1. fetches your newest kind 30008 `d=profile_badges` event from every read and write relay, failing with `SomeRelaysUnanswered` when none was found while a relay did not answer, because a publish would replace a list you have not seen;
2. publishes the award event unchanged to your write relays, so contacts can fetch it (skipped when hiding);
3. publishes a new kind 30008 that drops every pair whose `a` names a `linky-supporter*` definition of `issuer`, keeps every other tag in order and the content, and appends the award's `a` + `e` pair. Its `created_at` is now, or one second after the fetched list when that is not older, so relays always replace the list.

It returns the `PlainEventReceipt` of the kind 30008. `fetchOwnProfileBadges()` returns the newest list as `FetchedProfileBadges` (its `a` + `e` pairs as `entries`), or `null` when every relay answered and none holds one.

## Contacts: verifying badges

Pass `supporterBadgeIssuer` to `ProfileWatch.watch` ([plain-events.md](./plain-events.md#watching)). The watch then also subscribes to kind 30008 `d=profile_badges` of the watched pubkeys, on the same relays as kind 0. For the newest event per pubkey it fetches the paired kind 8 events by id from the read relays (4 s per relay), verifies each with `verifySupporterAward` and checks that the award's `a` tag is the one the pair names; of several copies of one award, the first that passes counts. It then emits `SupporterBadgesUpdated` with `pubkey`, the verified `awards` and `updatedAt`, the profile badges' `created_at`. An event without supporter badges of the issuer emits an empty `awards` list, which means the contact shows none.

Awards that fail surface only to the inspector, as `ProfileEventDropped` with the award's id and the verification reason, `award-mismatch` or `award-missing`. When no relay answers the award fetch, or an award is missing while some relay did not answer, the event is dropped as `awards-unreachable` and a later copy of it is tried again.

## Wire format

| Event            | Kind  | Signed by | Tags, in order                                                                                | Content       |
| ---------------- | ----- | --------- | --------------------------------------------------------------------------------------------- | ------------- |
| badge definition | 30009 | issuer    | `d`, `name`, `description`, `image`, `thumb`                                                  | empty         |
| badge award      | 8     | issuer    | `["a", "30009:<issuer>:<d>"]`, `["p", supporter]`; `created_at` is `awardedAt`, no expiration | empty         |
| supporter result | 24137 | issuer    | `p` to, `client`, `["linky", "supporter_result"]`, `["e", tokenMessageId]`                    | JSON, below   |
| profile badges   | 30008 | supporter | `["d", "profile_badges"]`, then `a` + `e` pairs                                               | kept as found |

The supporter result is a rumor in one gift wrap to the supporter, always push-marked. Its content is one of:

```text
{"status":"issued","tier":"gold","awards":[<tiered kind 8>,<generic kind 8>]}
{"status":"thanks"}
{"status":"refused","reason":"mint_not_accepted"}
```

Each award in `awards` is the complete signed event (`id`, `pubkey`, `created_at`, `kind`, `tags`, `content`, `sig`).

## Errors

`NoRelayAcceptedEvent` (`publishBadgeDefinition`, `publishProfileBadge`: for the award or the kind 30008, see `kind`), `WrapNotDelivered` (`sendResult`), `AllRelaysUnreachable` and `NoReadRelaysConfigured` (every fetch, and `publishProfileBadge`), `SomeRelaysUnanswered` (`fetchOwnProfileBadges`, `publishProfileBadge`). After `SomeRelaysUnanswered` keep the local choice and try again later. See [the error table](./concepts.md#errors).
