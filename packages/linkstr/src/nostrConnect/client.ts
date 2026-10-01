import { Schema } from "effect";
import type { Duration, Effect } from "effect";
import { Pubkey, RelayUrl } from "../domain/primitives";
import type { SignedPlainEvent } from "../internal/nostrEvent";
import type { PlainEventTemplate } from "../internal/plainEvent";
import { RelayPublishResult } from "../services/NostrTransport";
import type { NostrConnectRelaysUnreachable } from "./domain";

/** What a `nostrconnect://` link asks the user's signer for. */
export class NostrConnectClientDraft extends Schema.Class<NostrConnectClientDraft>(
  "NostrConnectClientDraft",
)({
  /** The signer answers on these relays only. */
  relays: Schema.NonEmptyArray(RelayUrl),
  /** NIP-46 permissions, e.g. `DEVICE_AUTHORIZATION_PERMISSION`. */
  perms: Schema.Array(Schema.Trimmed.check(Schema.isNonEmpty())),
  /** Shown to the user by the signer; a device authorization repeats it. */
  name: Schema.optional(Schema.Trimmed.check(Schema.isNonEmpty())),
  url: Schema.optional(Schema.Trimmed.check(Schema.isNonEmpty())),
  image: Schema.optional(Schema.Trimmed.check(Schema.isNonEmpty())),
}) {}

/** The signer answered a request with an error, or with an event other than the one asked for. */
export class NostrConnectSignRefused extends Schema.TaggedError<NostrConnectSignRefused>()(
  "NostrConnectSignRefused",
  { method: Schema.String, reason: Schema.String },
) {}

/** No relay accepted a request to the signer. */
export class NostrConnectRequestNotDelivered extends Schema.TaggedError<NostrConnectRequestNotDelivered>()(
  "NostrConnectRequestNotDelivered",
  { results: Schema.Array(RelayPublishResult) },
) {}

/** The signer did not connect, or did not reply, in time. */
export class NostrConnectSignerTimedOut extends Schema.TaggedError<NostrConnectSignerTimedOut>()(
  "NostrConnectSignerTimedOut",
  { waitingFor: Schema.Literals(["connect", "reply"]) },
) {}

export type NostrConnectSignError =
  | NostrConnectSignRefused
  | NostrConnectRequestNotDelivered
  | NostrConnectSignerTimedOut
  | NostrConnectRelaysUnreachable;

/**
 * One open `nostrconnect://` pairing under a throwaway client key. It lives
 * as long as the scope `open` ran in; closing the scope ends every
 * subscription and forgets the key.
 */
export interface NostrConnectSession {
  /** Show as a QR code or open as `<signer web app>/#<uri>`. Carries the pairing secret. */
  readonly uri: string;
  readonly clientPubkey: Pubkey;
  /** The signer's pubkey, once it answered the link with its secret. */
  readonly connected: Effect.Effect<
    Pubkey,
    NostrConnectSignerTimedOut | NostrConnectRelaysUnreachable
  >;
  /**
   * Waits for `connected`, asks the signer to sign `template` and verifies
   * the answer is that template, signed. The signer sets `created_at`.
   */
  readonly signEvent: (
    template: PlainEventTemplate,
  ) => Effect.Effect<SignedPlainEvent, NostrConnectSignError>;
}

export interface NostrConnectClientOptions {
  /** How long `connected` waits for the user to approve; 5 minutes by default. */
  readonly connectTimeout?: Duration.Input;
  /** How long one request waits for its reply; 60 s by default. */
  readonly replyTimeout?: Duration.Input;
}

/** The `nostrconnect://` text for a client key, secret and draft. */
export const encodeNostrConnectUri = (
  clientPubkey: Pubkey,
  secret: string,
  draft: NostrConnectClientDraft,
): string => {
  const params = new URLSearchParams();
  for (const relay of draft.relays) params.append("relay", relay);
  params.set("secret", secret);
  if (draft.perms.length > 0) params.set("perms", draft.perms.join(","));
  if (draft.name !== undefined) params.set("name", draft.name);
  if (draft.url !== undefined) params.set("url", draft.url);
  if (draft.image !== undefined) params.set("image", draft.image);
  return `nostrconnect://${clientPubkey}?${params.toString()}`;
};
