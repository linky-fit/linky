import { Effect } from "effect";
import { encrypt, getConversationKey } from "nostr-tools/nip44";
import type { PlainEventReceipt } from "../domain/delivery";
import type { NoRelayAcceptedEvent } from "../domain/errors";
import type { Pubkey } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { inspectPlainOperation } from "../internal/inspectPlainOperation";
import { deliverPlainEvent } from "../internal/plainDelivery";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";

const MUTE_LIST_KIND = 10000;

const encodeMuteTags = (pubkeys: ReadonlyArray<Pubkey>): string =>
  JSON.stringify(pubkeys.map((pubkey): Array<string> => ["p", pubkey]));

export class MuteList extends Effect.Service<MuteList>()("linkstr/MuteList", {
  effect: Effect.gen(function* () {
    const context = {
      identity: yield* LinkstrIdentity,
      transport: yield* NostrTransport,
      relayPolicy: yield* RelayPolicy,
    };
    const inspector = yield* Inspector.orNoop;

    const selfConversationKey = getConversationKey(
      context.identity.secretKey,
      context.identity.pubkey,
    );

    const publishMuteList = (
      pubkeys: ReadonlyArray<Pubkey>,
    ): Effect.Effect<PlainEventReceipt, NoRelayAcceptedEvent> =>
      deliverPlainEvent(context, {
        kind: MUTE_LIST_KIND,
        tags: [],
        content: encrypt(encodeMuteTags(pubkeys), selfConversationKey),
      }).pipe(
        Effect.map((receipt) => ({
          result: receipt,
          eventIds: [receipt.eventId],
        })),
        inspectPlainOperation(inspector, "muteList.publish", pubkeys),
      );

    return { publishMuteList } as const;
  }),
}) {}
