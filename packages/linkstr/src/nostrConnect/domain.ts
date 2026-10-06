import { Schema } from "effect";
import { RelayRejection } from "../domain/delivery";
import { EventId, Pubkey, RelayUrl, UnixSeconds } from "../domain/primitives";
import { SignedPlainEvent } from "../internal/nostrEvent";
import { RelayPublishResult } from "../services/NostrTransport";

/** A parsed `nostrconnect://` URI: a site asking the identity to log it in. */
export class NostrConnectRequest extends Schema.Class<NostrConnectRequest>(
  "NostrConnectRequest",
)({
  clientPubkey: Pubkey,
  relays: Schema.NonEmptyArray(RelayUrl),
  /** Proves the ack comes from whoever scanned the URI; never log it. */
  secret: Schema.NonEmptyString,
  perms: Schema.Array(Schema.String),
  /** Claimed by the site, unverified. */
  name: Schema.NullOr(Schema.String),
  /** Claimed by the site, unverified; signed `u` tags must match its host. */
  url: Schema.NullOr(Schema.String),
  image: Schema.NullOr(Schema.String),
}) {}

export class NostrConnectLoginReceipt extends Schema.Class<NostrConnectLoginReceipt>(
  "NostrConnectLoginReceipt",
)({
  clientPubkey: Pubkey,
  /** Null when the client only asked for the public key. */
  signedKind: Schema.NullOr(Schema.Number),
  /** The device key a signed device authorization names; null otherwise. */
  authorizedDevice: Schema.NullOr(Pubkey),
}) {}

/** A verified kind 24138 event: `author` lets `device` act for it in `app`. */
export class DeviceAuthorization extends Schema.Class<DeviceAuthorization>(
  "DeviceAuthorization",
)({
  eventId: EventId,
  author: Pubkey,
  device: Pubkey,
  /** The app name the user approved, as the app's link stated it. */
  app: Schema.String,
  createdAt: UnixSeconds,
  /** The signed event, for embedding and re-verifying elsewhere. */
  event: SignedPlainEvent,
}) {}

/** No relay accepted the connect ack or a later reply, so the site never got it. */
export class NostrConnectAckNotDelivered extends Schema.TaggedError<NostrConnectAckNotDelivered>()(
  "NostrConnectAckNotDelivered",
  { results: Schema.Array(RelayPublishResult) },
) {}

/** The site asked for a signature the login policy does not allow. */
export class NostrConnectRequestRefused extends Schema.TaggedError<NostrConnectRequestRefused>()(
  "NostrConnectRequestRefused",
  { method: Schema.String, reason: Schema.String },
) {}

/** The site answered nothing within the login window. */
export class NostrConnectTimedOut extends Schema.TaggedError<NostrConnectTimedOut>()(
  "NostrConnectTimedOut",
  {},
) {}

/** Every request subscription ended (unreachable or closed by the relay), so no request can arrive. */
export class NostrConnectRelaysUnreachable extends Schema.TaggedError<NostrConnectRelaysUnreachable>()(
  "NostrConnectRelaysUnreachable",
  { failures: Schema.Array(RelayRejection) },
) {}
