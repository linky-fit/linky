import { Duration, Effect, Schema } from "effect";
import type { PlainEventReceipt } from "../domain/delivery";
import type {
  AllRelaysUnreachable,
  NoRelayAcceptedEvent,
} from "../domain/errors";
import { NoReadRelaysConfigured, SomeRelaysUnanswered } from "../domain/errors";
import { EventId, isPubkey, Pubkey, UnixSeconds } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { inspectPlainOperation } from "../internal/inspectPlainOperation";
import { tagValues } from "../internal/nostrEvent";
import { deliverPlainEvent } from "../internal/plainDelivery";
import { fetchRawEvents, toPlainEvents } from "../internal/plainFetch";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";

const MUTE_LIST_KIND = 10000;

/** Callers hold their inbox on this fetch, so a silent relay must not stall it. */
const FETCH_PER_RELAY_TIMEOUT = Duration.seconds(4);

/** Your newest mute list: its public `p` entries and when it was signed. */
export class FetchedMuteList extends Schema.Class<FetchedMuteList>(
  "FetchedMuteList",
)({
  eventId: EventId,
  pubkeys: Schema.Array(Pubkey),
  createdAt: UnixSeconds,
}) {}

export class MuteList extends Effect.Service<MuteList>()("linkstr/MuteList", {
  effect: Effect.gen(function* () {
    const context = {
      identity: yield* LinkstrIdentity,
      transport: yield* NostrTransport,
      relayPolicy: yield* RelayPolicy,
    };
    const inspector = yield* Inspector.orNoop;

    const publishMuteList = (
      pubkeys: ReadonlyArray<Pubkey>,
    ): Effect.Effect<PlainEventReceipt, NoRelayAcceptedEvent> =>
      deliverPlainEvent(context, {
        kind: MUTE_LIST_KIND,
        tags: pubkeys.map((pubkey): Array<string> => ["p", pubkey]),
        content: "",
      }).pipe(
        Effect.map((receipt) => ({
          result: receipt,
          eventIds: [receipt.eventId],
        })),
        inspectPlainOperation(inspector, "muteList.publish", pubkeys),
      );

    const fetchOwnMuteList = (): Effect.Effect<
      FetchedMuteList | null,
      AllRelaysUnreachable | SomeRelaysUnanswered | NoReadRelaysConfigured
    > =>
      Effect.gen(function* () {
        const relays = [
          ...new Set([
            ...context.relayPolicy.readRelays,
            ...context.relayPolicy.writeRelays,
          ]),
        ];
        if (relays.length === 0) return yield* new NoReadRelaysConfigured();
        const { events, failures } = yield* fetchRawEvents(
          context.transport,
          relays,
          { kinds: [MUTE_LIST_KIND], authors: [context.identity.pubkey] },
          { perRelayTimeout: FETCH_PER_RELAY_TIMEOUT },
        );
        const newest = toPlainEvents(events).find(
          (event) =>
            event.pubkey === context.identity.pubkey &&
            event.kind === MUTE_LIST_KIND,
        );
        // A silent relay may hold the only list, so "none" needs every relay's answer.
        if (newest === undefined && failures.length > 0)
          return yield* new SomeRelaysUnanswered({ failures });
        if (newest === undefined) return { result: null, eventIds: [] };
        return {
          result: new FetchedMuteList({
            eventId: newest.id,
            pubkeys: [...new Set(tagValues(newest.tags, "p"))].filter(isPubkey),
            createdAt: UnixSeconds.make(newest.created_at),
          }),
          eventIds: [newest.id],
        };
      }).pipe(inspectPlainOperation(inspector, "muteList.fetchOwn", null));

    return { publishMuteList, fetchOwnMuteList } as const;
  }),
}) {}
