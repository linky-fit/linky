import { Schema } from "effect";
import { WrapDelivery } from "../domain/delivery";
import { InboxDelivery } from "../inbox/events";
import {
  ClientId,
  EventId,
  RelayUrl,
  RumorId,
  UnixSeconds,
  WrapId,
} from "../domain/primitives";
import { RelayPublishResult } from "../services/NostrTransport";

/**
 * Diagnostic taps over everything linkstr does on nostr, emitted only when the
 * optional `Inspector` service is provided. `Schema.Unknown` fields carry full
 * raw values for display; nothing in the package reads them back.
 *
 * Emission sites construct these with `{ disableChecks: true }` so an
 * off-brand field still reaches the feed; a field of the wrong type throws,
 * and `emit` logs and drops that event.
 */

/** A vertical finished sending, e.g. `name: "reactions.react"`. */
export class OperationSucceeded extends Schema.TaggedClass<OperationSucceeded>()(
  "OperationSucceeded",
  {
    name: Schema.String,
    params: Schema.Unknown,
    rumorId: RumorId,
    clientId: ClientId,
    sentAt: UnixSeconds,
    /** Null for single-copy deliveries (payment notices have no self copy). */
    selfCopy: Schema.NullOr(WrapDelivery),
    recipientCopy: WrapDelivery,
  },
) {}

export class OperationFailed extends Schema.TaggedClass<OperationFailed>()(
  "OperationFailed",
  {
    name: Schema.String,
    params: Schema.Unknown,
    error: Schema.Unknown,
  },
) {}

/**
 * A plain-event vertical finished, e.g. `name: "profiles.publishProfile"`.
 * `eventIds` are the signed events published — or, for fetches, the events the
 * result was read from — correlating the operation with its wire rows.
 * Failures reuse `OperationFailed`, which is not wrap-shaped.
 */
export class PlainOperationSucceeded extends Schema.TaggedClass<PlainOperationSucceeded>()(
  "PlainOperationSucceeded",
  {
    name: Schema.String,
    params: Schema.Unknown,
    eventIds: Schema.Array(Schema.Union([EventId, WrapId])),
    result: Schema.Unknown,
  },
) {}

/** One signed wrap pushed to the write relays, with per-relay outcomes. */
export class WirePublished extends Schema.TaggedClass<WirePublished>()(
  "WirePublished",
  {
    wrapId: WrapId,
    wrap: Schema.Unknown,
    results: Schema.Array(RelayPublishResult),
  },
) {}

/** One signed plain (non-gift-wrapped) event pushed to the write relays. */
export class WirePlainPublished extends Schema.TaggedClass<WirePlainPublished>()(
  "WirePlainPublished",
  {
    eventId: EventId,
    kind: Schema.Int,
    event: Schema.Unknown,
    results: Schema.Array(RelayPublishResult),
  },
) {}

/** A one-shot EOSE-bounded fetch; `detail` names the failure when the relay was unreachable. */
export class WireFetched extends Schema.TaggedClass<WireFetched>()(
  "WireFetched",
  {
    relay: RelayUrl,
    filter: Schema.Unknown,
    events: Schema.Array(Schema.Unknown),
    detail: Schema.NullOr(Schema.String),
  },
) {}

export class WireSubscribed extends Schema.TaggedClass<WireSubscribed>()(
  "WireSubscribed",
  {
    relay: RelayUrl,
    filter: Schema.Unknown,
  },
) {}

export class WireSubscriptionEnded extends Schema.TaggedClass<WireSubscriptionEnded>()(
  "WireSubscriptionEnded",
  {
    relay: RelayUrl,
    detail: Schema.NullOr(Schema.String),
  },
) {}

/** A raw relay event as received; relay-controlled, so untyped. */
export class WireEventReceived extends Schema.TaggedClass<WireEventReceived>()(
  "WireEventReceived",
  {
    relay: RelayUrl,
    event: Schema.Unknown,
  },
) {}

/** The inbox skipped a wrap already handled from another relay. */
export class InboxWrapDeduped extends Schema.TaggedClass<InboxWrapDeduped>()(
  "InboxWrapDeduped",
  {
    wrapId: WrapId,
  },
) {}

/**
 * The inbox stopped holding its cursor for a relay whose last
 * `failedAttempts` attempts all ended before its backfill walk finished, so
 * one failing relay cannot hold the cursor for the whole session.
 */
export class InboxWalkGivenUp extends Schema.TaggedClass<InboxWalkGivenUp>()(
  "InboxWalkGivenUp",
  {
    relay: RelayUrl,
    failedAttempts: Schema.Int,
  },
) {}

/**
 * The inbox turned a wrap into a typed fact — including `WrapDropped` ones,
 * which is where unknown rumor kinds surface (`rumorKind` names them; it is
 * null when the wrap failed authentication before decryption).
 */
export class InboxRouted extends Schema.TaggedClass<InboxRouted>()(
  "InboxRouted",
  {
    wrapId: Schema.NullOr(WrapId),
    rumorKind: Schema.NullOr(Schema.Int),
    delivery: InboxDelivery,
    event: Schema.Unknown,
  },
) {}

/**
 * The inbox's consumer failed to handle an event, so it stays unconfirmed
 * and holds the cursor until the inbox reopens. Emitted by the consumer
 * (linkstr-react's `wrapInboxAtom`), not by `WrapInbox`.
 */
export class InboxEventUnconfirmed extends Schema.TaggedClass<InboxEventUnconfirmed>()(
  "InboxEventUnconfirmed",
  {
    wrapId: Schema.NullOr(WrapId),
    delivery: InboxDelivery,
    eventTag: Schema.String,
    error: Schema.String,
  },
) {}

/**
 * ProfileWatch turned a relay event into a typed fact — or dropped it, in
 * which case `event` is a `ProfileEventDropped` naming the reason. Sibling of
 * `InboxRouted`; `eventId`/`kind` are null when decoding failed before either
 * was known.
 */
export class ProfileWatchRouted extends Schema.TaggedClass<ProfileWatchRouted>()(
  "ProfileWatchRouted",
  {
    eventId: Schema.NullOr(EventId),
    kind: Schema.NullOr(Schema.Int),
    event: Schema.Unknown,
  },
) {}

export type InspectorEvent =
  | OperationSucceeded
  | OperationFailed
  | PlainOperationSucceeded
  | WirePublished
  | WirePlainPublished
  | WireFetched
  | WireSubscribed
  | WireSubscriptionEnded
  | WireEventReceived
  | InboxWrapDeduped
  | InboxWalkGivenUp
  | InboxRouted
  | InboxEventUnconfirmed
  | ProfileWatchRouted;
