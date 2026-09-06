import { schnorr } from "@noble/curves/secp256k1";
import { Schema } from "effect";
import { getPublicKey } from "nostr-tools";

const HEX_64 = /^[0-9a-f]{64}$/;

// A 64-hex string is not necessarily a point on the curve; an off-curve
// "pubkey" would make key derivation throw deep inside a send or unwrap.
const isOnCurve = (hex: string): boolean => {
  try {
    schnorr.utils.lift_x(BigInt(`0x${hex}`));
    return true;
  } catch {
    return false;
  }
};

export const Pubkey = Schema.String.pipe(
  Schema.pattern(HEX_64),
  Schema.filter(isOnCurve, { description: "a secp256k1 x-only public key" }),
  Schema.brand("Pubkey"),
);
export type Pubkey = typeof Pubkey.Type;
export const isPubkey = Schema.is(Pubkey);

/**
 * Id of the inner (unsigned) rumor — the stable identity of a message or
 * reaction. Distinct from WrapId: gift wraps are regenerated on every publish,
 * rumor ids are not.
 */
export const RumorId = Schema.String.pipe(
  Schema.pattern(HEX_64),
  Schema.brand("RumorId"),
);
export type RumorId = typeof RumorId.Type;
export const isRumorId = Schema.is(RumorId);

/** Id of a signed outer gift-wrap event — transport-level identity only. */
export const WrapId = Schema.String.pipe(
  Schema.pattern(HEX_64),
  Schema.brand("WrapId"),
);
export type WrapId = typeof WrapId.Type;

/** Id of a signed plain (non-gift-wrapped) event: profile, status, relay lists, … */
export const EventId = Schema.String.pipe(
  Schema.pattern(HEX_64),
  Schema.brand("EventId"),
);
export type EventId = typeof EventId.Type;

/**
 * Locally generated id travelling in the ["client", …] tag; the key used to
 * reconcile an optimistic local row with its relay echo.
 */
export const ClientId = Schema.NonEmptyTrimmedString.pipe(
  Schema.brand("ClientId"),
);
export type ClientId = typeof ClientId.Type;
export const isClientId = Schema.is(ClientId);

const isRelayUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "ws:" || url.protocol === "wss:") &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
};

export const RelayUrl = Schema.NonEmptyTrimmedString.pipe(
  Schema.filter(isRelayUrl, {
    description: "a ws:// or wss:// url with a host",
  }),
  Schema.brand("RelayUrl"),
);
export type RelayUrl = typeof RelayUrl.Type;

export const UnixSeconds = Schema.Int.pipe(
  Schema.positive(),
  Schema.brand("UnixSeconds"),
);
export type UnixSeconds = typeof UnixSeconds.Type;
export const isUnixSeconds = Schema.is(UnixSeconds);

const isUsableSecretKey = (bytes: Uint8Array): boolean => {
  if (bytes.length !== 32) return false;
  try {
    getPublicKey(bytes);
    return true;
  } catch {
    return false;
  }
};

export const NostrSecretKey = Schema.Uint8ArrayFromSelf.pipe(
  Schema.filter(isUsableSecretKey, {
    description: "a 32-byte secp256k1 secret key in curve order",
  }),
  Schema.brand("NostrSecretKey"),
);
export type NostrSecretKey = typeof NostrSecretKey.Type;
