import { Context, Duration, Effect, Layer, Option, Schema } from "effect";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";
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

/** One block or unblock with its time, kept in the list's encrypted part. */
export class MuteListChange extends Schema.Class<MuteListChange>(
  "MuteListChange",
)({
  pubkey: Pubkey,
  muted: Schema.Boolean,
  at: UnixSeconds,
}) {}

/**
 * Your newest mute list: its public `p` entries, the timed changes it carries
 * privately (empty when it has none Linky can read) and when it was signed.
 */
export class FetchedMuteList extends Schema.Class<FetchedMuteList>(
  "FetchedMuteList",
)({
  eventId: EventId,
  pubkeys: Schema.Array(Pubkey),
  changes: Schema.Array(MuteListChange),
  createdAt: UnixSeconds,
}) {}

export interface PublishMuteListOptions {
  /** Timed blocks and unblocks, published encrypted to yourself. */
  readonly changes?: ReadonlyArray<MuteListChange>;
  /** The `createdAt` of the newest list you know; the new one is dated after it. */
  readonly replaces?: UnixSeconds;
}

const decodeChangeTags = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.Array(Schema.String))),
);

const encodeChanges = (
  changes: ReadonlyArray<MuteListChange>,
  conversationKey: Uint8Array,
): string =>
  changes.length === 0
    ? ""
    : encrypt(
        JSON.stringify(
          changes.map((change) => [
            change.muted ? "muted" : "unmuted",
            change.pubkey,
            String(change.at),
          ]),
        ),
        conversationKey,
      );

const decryptOrNull = (
  content: string,
  conversationKey: Uint8Array,
): string | null => {
  try {
    return decrypt(content, conversationKey);
  } catch {
    return null;
  }
};

// Content another client encrypted differently, or none, holds no changes.
const decodeChanges = (
  content: string,
  conversationKey: Uint8Array,
): ReadonlyArray<MuteListChange> => {
  const plaintext = content ? decryptOrNull(content, conversationKey) : null;
  const tags =
    plaintext === null
      ? []
      : Option.getOrElse(decodeChangeTags(plaintext), () => []);
  return tags.flatMap(([kind, pubkey, at]) => {
    const seconds = Number(at);
    return (kind === "muted" || kind === "unmuted") &&
      pubkey !== undefined &&
      isPubkey(pubkey) &&
      Number.isSafeInteger(seconds) &&
      seconds > 0
      ? [
          new MuteListChange({
            pubkey,
            muted: kind === "muted",
            at: UnixSeconds.make(seconds),
          }),
        ]
      : [];
  });
};

export class MuteList extends Context.Service<MuteList>()("linkstr/MuteList", {
  make: Effect.gen(function* () {
    const context = {
      identity: yield* LinkstrIdentity,
      transport: yield* NostrTransport,
      relayPolicy: yield* RelayPolicy,
    };
    const inspector = yield* Inspector.orNoop;

    const ownKey = getConversationKey(
      context.identity.secretKey,
      context.identity.pubkey,
    );

    const publishMuteList = (
      pubkeys: ReadonlyArray<Pubkey>,
      options: PublishMuteListOptions = {},
    ): Effect.Effect<PlainEventReceipt, NoRelayAcceptedEvent> =>
      deliverPlainEvent(
        context,
        {
          kind: MUTE_LIST_KIND,
          tags: pubkeys.map((pubkey): Array<string> => ["p", pubkey]),
          content: encodeChanges(options.changes ?? [], ownKey),
        },
        options.replaces,
      ).pipe(
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
            changes: decodeChanges(newest.content, ownKey),
            createdAt: UnixSeconds.make(newest.created_at),
          }),
          eventIds: [newest.id],
        };
      }).pipe(inspectPlainOperation(inspector, "muteList.fetchOwn", null));

    return { publishMuteList, fetchOwnMuteList } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
