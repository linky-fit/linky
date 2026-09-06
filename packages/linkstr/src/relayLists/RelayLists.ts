import { Duration, Effect, Either, Schema } from "effect";
import type {
  AllRelaysUnreachable,
  NoRelayAcceptedEvent,
} from "../domain/errors";
import { NoReadRelaysConfigured } from "../domain/errors";
import { RelayUrl } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { inspectPlainOperation } from "../internal/inspectPlainOperation";
import type { NostrTags, SignedPlainEvent } from "../internal/nostrEvent";
import { deliverPlainEvent } from "../internal/plainDelivery";
import { fetchPlainEvents } from "../internal/plainFetch";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import { FetchedRelayLists, RelayListEntry, RelayListsReceipt } from "./domain";
import type { RelayListsDraft } from "./domain";

const RELAY_LIST_KIND = 10002;
const DM_RELAY_LIST_KIND = 10050;

/**
 * The fetched lists gate the app's relay configuration, so one slow relay
 * must not hold the fan-out for the transport's full ~11s worst case.
 */
const FETCH_PER_RELAY_TIMEOUT = Duration.seconds(8);

const isRelayUrl = Schema.is(RelayUrl);
const isMarker = (value: string): value is "read" | "write" =>
  value === "read" || value === "write";

const encodeRelayListTags = (
  entries: ReadonlyArray<RelayListEntry>,
): NostrTags =>
  entries.map((entry) =>
    entry.marker === null
      ? ["r", entry.relay]
      : ["r", entry.relay, entry.marker],
  );

const encodeDmRelayTags = (relays: ReadonlyArray<RelayUrl>): NostrTags =>
  relays.map((relay) => ["relay", relay]);

/** Tolerant per-entry decode: entries that are not relay urls are dropped. */
const decodeRelayListEntries = (
  event: SignedPlainEvent,
): Array<RelayListEntry> =>
  event.tags.flatMap((tag) => {
    if (tag[0] !== "r" || tag[1] === undefined || !isRelayUrl(tag[1])) {
      return [];
    }
    const marker = tag[2];
    return [
      new RelayListEntry({
        relay: tag[1],
        marker: marker !== undefined && isMarker(marker) ? marker : null,
      }),
    ];
  });

const decodeDmRelays = (event: SignedPlainEvent): Array<RelayUrl> =>
  event.tags.flatMap((tag) =>
    tag[0] === "relay" && tag[1] !== undefined && isRelayUrl(tag[1])
      ? [tag[1]]
      : [],
  );

export class RelayLists extends Effect.Service<RelayLists>()(
  "linkstr/RelayLists",
  {
    effect: Effect.gen(function* () {
      const context = {
        identity: yield* LinkstrIdentity,
        transport: yield* NostrTransport,
        relayPolicy: yield* RelayPolicy,
      };
      const inspector = yield* Inspector.orNoop;

      const publishRelayLists = (
        draft: RelayListsDraft,
      ): Effect.Effect<RelayListsReceipt, NoRelayAcceptedEvent> =>
        Effect.gen(function* () {
          // Both publishes always run to completion; failing fast on one would
          // interrupt the other mid-publish.
          const [relayList, dmRelayList] = yield* Effect.all(
            [
              Effect.either(
                deliverPlainEvent(context, {
                  kind: RELAY_LIST_KIND,
                  tags: encodeRelayListTags(draft.relays),
                  content: "",
                }),
              ),
              Effect.either(
                deliverPlainEvent(context, {
                  kind: DM_RELAY_LIST_KIND,
                  tags: encodeDmRelayTags(draft.dmRelays),
                  content: "",
                }),
              ),
            ],
            { concurrency: "unbounded" },
          );
          if (Either.isLeft(relayList)) return yield* relayList.left;
          if (Either.isLeft(dmRelayList)) return yield* dmRelayList.left;
          const receipt = new RelayListsReceipt({
            relayList: relayList.right,
            dmRelayList: dmRelayList.right,
          });
          return {
            result: receipt,
            eventIds: [receipt.relayList.eventId, receipt.dmRelayList.eventId],
          };
        }).pipe(inspectPlainOperation(inspector, "relayLists.publish", draft));

      const fetchOwnRelayLists = (): Effect.Effect<
        FetchedRelayLists,
        AllRelaysUnreachable | NoReadRelaysConfigured
      > =>
        Effect.gen(function* () {
          const relays = context.relayPolicy.readRelays;
          if (relays.length === 0) return yield* new NoReadRelaysConfigured();
          const events = yield* fetchPlainEvents(
            context.transport,
            relays,
            {
              kinds: [RELAY_LIST_KIND, DM_RELAY_LIST_KIND],
              authors: [context.identity.pubkey],
            },
            { perRelayTimeout: FETCH_PER_RELAY_TIMEOUT },
          );
          const own = events.filter(
            (event) => event.pubkey === context.identity.pubkey,
          );
          const relayList =
            own.find((event) => event.kind === RELAY_LIST_KIND) ?? null;
          const dmRelayList =
            own.find((event) => event.kind === DM_RELAY_LIST_KIND) ?? null;
          return {
            result: new FetchedRelayLists({
              relays:
                relayList === null ? null : decodeRelayListEntries(relayList),
              relaysUpdatedAt: relayList?.created_at ?? null,
              dmRelays:
                dmRelayList === null ? null : decodeDmRelays(dmRelayList),
              dmRelaysUpdatedAt: dmRelayList?.created_at ?? null,
            }),
            eventIds: [relayList, dmRelayList].flatMap((event) =>
              event === null ? [] : [event.id],
            ),
          };
        }).pipe(inspectPlainOperation(inspector, "relayLists.fetchOwn", null));

      return { publishRelayLists, fetchOwnRelayLists } as const;
    }),
  },
) {}
