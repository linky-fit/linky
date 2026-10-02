import { Either, Option, Schema } from "effect";
import { ClientId, EventId, RelayUrl, UnixSeconds } from "./domain/primitives";
import type { NostrSecretKey } from "./domain/primitives";
import { SignedPlainEvent, singleTagValue } from "./internal/nostrEvent";
import {
  decodeVerifiedPlainEvent,
  signPlainEvent,
} from "./internal/plainEvent";

export const LnurlWithdrawSessionOptions = Schema.Struct({
  apiUrl: Schema.String,
  relays: Schema.Array(RelayUrl).pipe(Schema.minItems(1), Schema.maxItems(3)),
  maxAmountSat: Schema.Int.pipe(Schema.between(1, 100_000)),
  maxFeeSat: Schema.Int.pipe(Schema.between(0, 1_000)),
  expiresAtSec: UnixSeconds,
});
export type LnurlWithdrawSessionOptions =
  typeof LnurlWithdrawSessionOptions.Type;

/** A short-lived authorization, signed locally and never published. */
export const makeLnurlWithdrawSession = (
  options: LnurlWithdrawSessionOptions,
  secretKey: NostrSecretKey,
  now: UnixSeconds,
): SignedPlainEvent =>
  signPlainEvent(
    {
      kind: 24137,
      tags: [["linky", "lnurl_withdraw_session"]],
      content: JSON.stringify(
        Schema.decodeUnknownSync(LnurlWithdrawSessionOptions)(options),
      ),
    },
    now,
    secretKey,
  );

export const readLnurlWithdrawSession = (input: unknown, now: UnixSeconds) => {
  const verified = decodeVerifiedPlainEvent(input);
  if (Either.isLeft(verified)) throw new Error("Invalid session signature");
  const session = verified.right;
  if (
    session.kind !== 24137 ||
    singleTagValue(session.tags, "linky") !== "lnurl_withdraw_session"
  ) {
    throw new Error("Invalid session kind");
  }
  const options = Schema.decodeUnknownSync(
    Schema.parseJson(LnurlWithdrawSessionOptions),
  )(session.content);
  if (
    session.created_at > now + 5 ||
    options.expiresAtSec <= now ||
    options.expiresAtSec > session.created_at + 120
  ) {
    throw new Error("Session expired or exceeds the two-minute lifetime");
  }
  return { session, options };
};

const RequestFields = {
  session: SignedPlainEvent,
  requestId: ClientId,
  deadline: UnixSeconds,
};
export const LnurlWithdrawBridgeRequest = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("linky.lnurlw.probe"),
    ...RequestFields,
  }),
  Schema.Struct({
    type: Schema.Literal("linky.lnurlw.pay"),
    ...RequestFields,
    invoice: Schema.String,
  }),
);
export type LnurlWithdrawBridgeRequest = typeof LnurlWithdrawBridgeRequest.Type;

export const LnurlWithdrawBridgeReply = Schema.Struct({
  type: Schema.Literal("linky.lnurlw.reply"),
  sessionId: EventId,
  requestId: ClientId,
  status: Schema.Literal("ready", "accepted", "rejected"),
  reason: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
});
export type LnurlWithdrawBridgeReply = typeof LnurlWithdrawBridgeReply.Type;

export const parseLnurlWithdrawBridgeRequest = (text: string) =>
  Option.getOrNull(
    Schema.decodeUnknownOption(Schema.parseJson(LnurlWithdrawBridgeRequest))(
      text,
    ),
  );
export const parseLnurlWithdrawBridgeReply = (text: string) =>
  Option.getOrNull(
    Schema.decodeUnknownOption(Schema.parseJson(LnurlWithdrawBridgeReply))(
      text,
    ),
  );
