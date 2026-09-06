import { Schema } from "effect";
import { RelayPublishResult } from "../services/NostrTransport";
import { RelayRejection, WrapDelivery } from "./delivery";
import { ClientId, EventId, RumorId, UnixSeconds } from "./primitives";

const deliveryFailureFields = {
  rumorId: RumorId,
  clientId: ClientId,
  sentAt: UnixSeconds,
  selfCopy: WrapDelivery,
  recipientCopy: WrapDelivery,
};

/** No relay accepted anything — not even the self copy. */
export class NoRelayReachable extends Schema.TaggedError<NoRelayReachable>()(
  "NoRelayReachable",
  deliveryFailureFields,
) {}

/**
 * The self copy landed but no relay accepted the recipient's wrap: the peer
 * will never see this event. Never silently degraded into "sent".
 */
export class RecipientNotReached extends Schema.TaggedError<RecipientNotReached>()(
  "RecipientNotReached",
  deliveryFailureFields,
) {}

/**
 * Single-copy sibling of `RecipientNotReached`: no relay accepted the only
 * wrap of a rumor that has no self copy (payment notices, telemetry).
 */
export class WrapNotDelivered extends Schema.TaggedError<WrapNotDelivered>()(
  "WrapNotDelivered",
  {
    rumorId: RumorId,
    clientId: ClientId,
    sentAt: UnixSeconds,
    recipientCopy: WrapDelivery,
  },
) {}

/** Plain-publish sibling of `NoRelayReachable`: no write relay accepted the event. */
export class NoRelayAcceptedEvent extends Schema.TaggedError<NoRelayAcceptedEvent>()(
  "NoRelayAcceptedEvent",
  {
    eventId: EventId,
    kind: Schema.Int,
    sentAt: UnixSeconds,
    results: Schema.Array(RelayPublishResult),
  },
) {}

/** A one-shot fetch reached no relay at all; partial reachability succeeds instead. */
export class AllRelaysUnreachable extends Schema.TaggedError<AllRelaysUnreachable>()(
  "AllRelaysUnreachable",
  {
    failures: Schema.Array(RelayRejection),
  },
) {}

export class NoReadRelaysConfigured extends Schema.TaggedError<NoReadRelaysConfigured>()(
  "NoReadRelaysConfigured",
  {},
) {}
