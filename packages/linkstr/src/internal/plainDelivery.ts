import { Effect } from "effect";
import { PlainEventReceipt } from "../domain/delivery";
import { NoRelayAcceptedEvent } from "../domain/errors";
import { UnixSeconds } from "../domain/primitives";
import type { LinkstrIdentityService } from "../services/LinkstrIdentity";
import type { NostrTransportService } from "../services/NostrTransport";
import type { RelayPolicyService } from "../services/RelayPolicy";
import { signPlainEvent } from "./plainEvent";
import type { PlainEventTemplate } from "./plainEvent";
import { nowSeconds } from "./time";

export interface PlainDeliveryContext {
  readonly identity: LinkstrIdentityService;
  readonly transport: NostrTransportService;
  readonly relayPolicy: RelayPolicyService;
}

/**
 * Shared by all plain-event verticals: sign one event with the configured
 * identity, publish it to every write relay, succeed when ≥1 relay accepts.
 * A replaceable event signed after `replaces` is dated past it, since a relay
 * keeps the lower id of two events from the same second.
 */
export const deliverPlainEvent = (
  { identity, relayPolicy, transport }: PlainDeliveryContext,
  template: PlainEventTemplate,
  replaces?: UnixSeconds,
): Effect.Effect<PlainEventReceipt, NoRelayAcceptedEvent> =>
  Effect.gen(function* () {
    const now = yield* nowSeconds;
    const sentAt =
      replaces !== undefined && now <= replaces
        ? UnixSeconds.make(replaces + 1)
        : now;
    const event = signPlainEvent(template, sentAt, identity.secretKey);
    const results = yield* transport.publish(relayPolicy.writeRelays, event);
    const receipt = new PlainEventReceipt({
      eventId: event.id,
      kind: event.kind,
      sentAt,
      results,
    });
    if (!receipt.accepted) {
      return yield* new NoRelayAcceptedEvent({
        eventId: event.id,
        kind: event.kind,
        sentAt,
        results,
      });
    }
    return receipt;
  });
