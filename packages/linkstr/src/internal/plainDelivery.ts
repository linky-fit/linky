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

/** A replaceable event signed after `replaces` is dated past it, since a relay keeps the lower id of two events from the same second. */
export const replacementDate = (
  replaces?: UnixSeconds,
): Effect.Effect<UnixSeconds> =>
  Effect.map(nowSeconds, (now) =>
    replaces !== undefined && now <= replaces
      ? UnixSeconds.make(replaces + 1)
      : now,
  );

/** Signs `template` dated `sentAt`, publishes it to every write relay, and succeeds when ≥1 relay accepts. */
export const publishPlainEvent = (
  { identity, relayPolicy, transport }: PlainDeliveryContext,
  template: PlainEventTemplate,
  sentAt: UnixSeconds,
): Effect.Effect<PlainEventReceipt, NoRelayAcceptedEvent> =>
  Effect.gen(function* () {
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

/** Shared by all plain-event verticals: one event, dated past the one it `replaces`. */
export const deliverPlainEvent = (
  context: PlainDeliveryContext,
  template: PlainEventTemplate,
  replaces?: UnixSeconds,
): Effect.Effect<PlainEventReceipt, NoRelayAcceptedEvent> =>
  Effect.flatMap(replacementDate(replaces), (sentAt) =>
    publishPlainEvent(context, template, sentAt),
  );
