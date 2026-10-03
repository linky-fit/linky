import { Duration, Effect } from "effect";
import type { PlainEventReceipt } from "../domain/delivery";
import type { AllRelaysUnreachable, WrapNotDelivered } from "../domain/errors";
import {
  NoReadRelaysConfigured,
  NoRelayAcceptedEvent,
  SomeRelaysUnanswered,
} from "../domain/errors";
import type { EventId, Pubkey, UnixSeconds } from "../domain/primitives";
import { inspectPlainOperation } from "../internal/inspectPlainOperation";
import type { InspectedPlainResult } from "../internal/inspectPlainOperation";
import { firstTagValue } from "../internal/nostrEvent";
import type { SignedPlainEvent } from "../internal/nostrEvent";
import { freshClientId } from "../internal/operations";
import { deliverPlainEvent } from "../internal/plainDelivery";
import { signPlainEvent } from "../internal/plainEvent";
import {
  fetchPlainEvents,
  fetchRawEvents,
  toPlainEvents,
} from "../internal/plainFetch";
import { nowSeconds } from "../internal/time";
import { makeWrapSendContext, sendToRecipient } from "../internal/wrapSend";
import {
  awardTemplate,
  BADGE_DEFINITION_KIND,
  badgeDefinitionTemplate,
  decodeBadgeDefinition,
  encodeSupporterResultRumor,
  PROFILE_BADGES_D,
  PROFILE_BADGES_KIND,
  profileBadgeEntries,
  rewriteProfileBadgeTags,
  SUPPORTER_BADGE_DS,
} from "./codec";
import {
  FetchedProfileBadges,
  PublishedBadgeDefinition,
  SupporterResultReceipt,
} from "./domain";
import type {
  BadgeDefinition,
  SupporterAward,
  SupporterAwardEvents,
  SupporterBadgeType,
  SupporterResultDraft,
  SupporterTier,
} from "./domain";

/** Callers hold a publish on this fetch, so a silent relay must not stall it. */
const FETCH_PER_RELAY_TIMEOUT = Duration.seconds(4);

/**
 * NIP-58 supporter badges. The issuer side publishes badge definitions,
 * signs awards and answers payments with a gift-wrapped supporter result;
 * the supporter side publishes an award in its profile badges.
 */
export class SupporterBadges extends Effect.Service<SupporterBadges>()(
  "linkstr/SupporterBadges",
  {
    effect: Effect.gen(function* () {
      const context = yield* makeWrapSendContext;
      const { identity, inspector, relayPolicy, transport } = context;

      const ownRelays = () => [
        ...new Set([...relayPolicy.readRelays, ...relayPolicy.writeRelays]),
      ];

      const publishBadgeDefinition = (
        definition: BadgeDefinition,
      ): Effect.Effect<PlainEventReceipt, NoRelayAcceptedEvent> =>
        deliverPlainEvent(context, badgeDefinitionTemplate(definition)).pipe(
          Effect.map((receipt) => ({
            result: receipt,
            eventIds: [receipt.eventId],
          })),
          inspectPlainOperation(
            inspector,
            "supporterBadges.publishDefinition",
            definition,
          ),
        );

      /** Newest definition per supporter badge; a malformed newest one is left out. */
      const fetchOwnBadgeDefinitions = (): Effect.Effect<
        ReadonlyArray<PublishedBadgeDefinition>,
        AllRelaysUnreachable | NoReadRelaysConfigured
      > =>
        Effect.gen(function* () {
          const relays = ownRelays();
          if (relays.length === 0) return yield* new NoReadRelaysConfigured();
          const events = yield* fetchPlainEvents(transport, relays, {
            kinds: [BADGE_DEFINITION_KIND],
            authors: [identity.pubkey],
            "#d": [...SUPPORTER_BADGE_DS],
          });
          const seen = new Set<string | null>();
          const result: Array<PublishedBadgeDefinition> = [];
          for (const event of events) {
            const d = firstTagValue(event.tags, "d");
            if (
              event.kind !== BADGE_DEFINITION_KIND ||
              event.pubkey !== identity.pubkey ||
              seen.has(d)
            )
              continue;
            seen.add(d);
            const definition = decodeBadgeDefinition(event);
            if (definition !== null)
              result.push(
                new PublishedBadgeDefinition({
                  eventId: event.id,
                  createdAt: event.created_at,
                  definition,
                }),
              );
          }
          return { result, eventIds: result.map(({ eventId }) => eventId) };
        }).pipe(
          inspectPlainOperation(
            inspector,
            "supporterBadges.fetchOwnDefinitions",
            null,
          ),
        );

      /** Signs, not publishes, the tiered and the generic award of one payment. */
      const signAwards = (
        supporter: Pubkey,
        tier: SupporterTier,
        awardedAt: UnixSeconds,
      ): Effect.Effect<SupporterAwardEvents> =>
        Effect.sync(() => {
          const sign = (badge: SupporterBadgeType) =>
            signPlainEvent(
              awardTemplate(identity.pubkey, badge, supporter),
              awardedAt,
              identity.secretKey,
            );
          const awards: SupporterAwardEvents = [sign(tier), sign("generic")];
          return { result: awards, eventIds: awards.map(({ id }) => id) };
        }).pipe(
          inspectPlainOperation(inspector, "supporterBadges.signAwards", {
            supporter,
            tier,
            awardedAt,
          }),
        );

      const sendResult = (
        draft: SupporterResultDraft,
      ): Effect.Effect<SupporterResultReceipt, WrapNotDelivered> =>
        Effect.gen(function* () {
          const clientId = draft.clientId ?? (yield* freshClientId);
          const sentAt = draft.sentAt ?? (yield* nowSeconds);
          return yield* sendToRecipient(
            context,
            "supporterBadges.sendResult",
            draft,
            {
              rumor: encodeSupporterResultRumor(
                draft,
                identity.pubkey,
                sentAt,
                clientId,
              ),
              recipient: draft.to,
              clientId,
              sentAt,
              pushMark: true,
              receipt: (outcome) => new SupporterResultReceipt(outcome),
            },
          );
        });

      const fetchNewestProfileBadges = Effect.gen(function* () {
        const relays = ownRelays();
        if (relays.length === 0) return yield* new NoReadRelaysConfigured();
        const { events, failures } = yield* fetchRawEvents(
          transport,
          relays,
          {
            kinds: [PROFILE_BADGES_KIND],
            authors: [identity.pubkey],
            "#d": [PROFILE_BADGES_D],
          },
          { perRelayTimeout: FETCH_PER_RELAY_TIMEOUT },
        );
        const newest = toPlainEvents(events).find(
          (event) =>
            event.pubkey === identity.pubkey &&
            event.kind === PROFILE_BADGES_KIND &&
            firstTagValue(event.tags, "d") === PROFILE_BADGES_D,
        );
        // A silent relay may hold the only list, so "none" needs every relay's answer.
        if (newest === undefined && failures.length > 0)
          return yield* new SomeRelaysUnanswered({ failures });
        return newest ?? null;
      });

      const fetchOwnProfileBadges = (): Effect.Effect<
        FetchedProfileBadges | null,
        AllRelaysUnreachable | SomeRelaysUnanswered | NoReadRelaysConfigured
      > =>
        Effect.map(
          fetchNewestProfileBadges,
          (newest): InspectedPlainResult<FetchedProfileBadges | null> =>
            newest === null
              ? { result: null, eventIds: [] }
              : {
                  result: new FetchedProfileBadges({
                    eventId: newest.id,
                    createdAt: newest.created_at,
                    entries: profileBadgeEntries(newest.tags),
                  }),
                  eventIds: [newest.id],
                },
        ).pipe(
          inspectPlainOperation(
            inspector,
            "supporterBadges.fetchOwnProfileBadges",
            null,
          ),
        );

      const publishAward = (award: SignedPlainEvent) =>
        Effect.gen(function* () {
          const results = yield* transport.publish(
            relayPolicy.writeRelays,
            award,
          );
          if (!results.some(({ accepted }) => accepted))
            return yield* new NoRelayAcceptedEvent({
              eventId: award.id,
              kind: award.kind,
              sentAt: yield* nowSeconds,
              results,
            });
        });

      /**
       * Publishes `award` unchanged, then rewrites your newest profile badges
       * so `issuer`'s supporter badges are exactly `award` (none when null),
       * keeping every other entry and the content.
       */
      const publishProfileBadge = (
        issuer: Pubkey,
        award: SupporterAward | null,
      ): Effect.Effect<
        PlainEventReceipt,
        | NoRelayAcceptedEvent
        | AllRelaysUnreachable
        | SomeRelaysUnanswered
        | NoReadRelaysConfigured
      > =>
        Effect.gen(function* () {
          const newest = yield* fetchNewestProfileBadges;
          if (award !== null) yield* publishAward(award.event);
          const receipt = yield* deliverPlainEvent(
            context,
            {
              kind: PROFILE_BADGES_KIND,
              tags: rewriteProfileBadgeTags(
                newest?.tags ?? [["d", PROFILE_BADGES_D]],
                issuer,
                award,
              ),
              content: newest?.content ?? "",
            },
            newest?.created_at,
          );
          const eventIds: Array<EventId> =
            award === null
              ? [receipt.eventId]
              : [award.event.id, receipt.eventId];
          return { result: receipt, eventIds };
        }).pipe(
          inspectPlainOperation(
            inspector,
            "supporterBadges.publishProfileBadge",
            { issuer, award },
          ),
        );

      return {
        publishBadgeDefinition,
        fetchOwnBadgeDefinitions,
        signAwards,
        sendResult,
        fetchOwnProfileBadges,
        publishProfileBadge,
      } as const;
    }),
  },
) {}
