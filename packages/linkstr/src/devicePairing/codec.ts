import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  bytesToHex,
  concatBytes,
  hexToBytes,
  utf8ToBytes,
} from "@noble/hashes/utils.js";
import { Option, Schema } from "effect";
import { RelayUrl } from "../domain/primitives";

/**
 * Finito's `payky:pair` protocol, byte for byte, so Linky, Fazole and Finito
 * add each other's devices. An ephemeral kind no NIP lists, so relays forward
 * it and store nothing.
 */
export const DEVICE_PAIRING_KIND = 28_581;

const Hex = (bytes: number) =>
  Schema.String.check(
    Schema.makeFilter((value) =>
      new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value),
    ),
  );

/** What the QR code carries: the offering device's ephemeral pubkey, the session secret and its relays. */
export class PairingInvite extends Schema.Class<PairingInvite>("PairingInvite")(
  {
    pk: Hex(32),
    /** Never log it: anyone holding it can answer the invite. */
    s: Hex(16),
    r: Schema.Array(RelayUrl).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(2),
    ),
  },
) {}

const decodeInvite = Schema.decodeUnknownOption(PairingInvite);

/**
 * The invite in a scanned or pasted `payky:pair?v=1&pk=…&s=…&r=…`, or `null`
 * when the text is not one this release reads (another type, a newer version,
 * a missing or malformed param, a malformed relay).
 */
export const parsePairingInvite = (text: string): PairingInvite | null => {
  const match = /^payky:([^?#]*)(?:\?([^#]*))?$/i.exec(text.trim());
  if (match?.[1]?.toLowerCase() !== "pair") return null;
  const params = new URLSearchParams(match[2] ?? "");
  if (params.get("v") !== "1") return null;
  return Option.getOrNull(
    decodeInvite({
      pk: params.get("pk"),
      s: params.get("s"),
      r: params.getAll("r"),
    }),
  );
};

export const encodePairingInvite = (invite: {
  readonly pk: string;
  readonly s: string;
  readonly r: ReadonlyArray<string>;
}): string => {
  const params = new URLSearchParams({ v: "1", pk: invite.pk, s: invite.s });
  for (const relay of invite.r) params.append("r", relay);
  return `payky:pair?${params.toString()}`;
};

const keyedHash = (
  label: string,
  sessionSecret: Uint8Array,
  sourcePubkey: string,
  targetPubkey: string,
) =>
  hmac(
    sha256,
    sessionSecret,
    concatBytes(
      utf8ToBytes(label),
      hexToBytes(sourcePubkey),
      hexToBytes(targetPubkey),
    ),
  );

/** Proves a `hello` comes from someone who saw the QR code; 64 hex. */
export const pairingHelloProof = (
  sessionSecret: Uint8Array,
  sourcePubkey: string,
  targetPubkey: string,
): string =>
  bytesToHex(
    keyedHash("payky:pair:hello:v1", sessionSecret, sourcePubkey, targetPubkey),
  );

/** The six digits both devices compute and neither sends. */
export const pairingCode = (
  sessionSecret: Uint8Array,
  sourcePubkey: string,
  targetPubkey: string,
): string => {
  const hash = keyedHash(
    "payky:pair:code:v1",
    sessionSecret,
    sourcePubkey,
    targetPubkey,
  );
  const value = new DataView(hash.buffer, hash.byteOffset).getUint32(0);
  return String(value % 1_000_000).padStart(6, "0");
};

/** `482913` as `482 913`. */
export const formatPairingCode = (code: string): string =>
  `${code.slice(0, 3)} ${code.slice(3)}`;

/**
 * What the new device receives: the 16-byte master secret behind the recovery
 * seed as hex, the account's name and the offering app's sync servers. A
 * secret: keep it out of logs.
 */
export const PairingPayload = Schema.Struct({
  masterKey: Hex(16),
  accountName: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(255),
  ),
  // Finito's Evolu transports, at most eight; a duplicate counts once.
  transports: Schema.Array(Schema.String).check(Schema.isMaxLength(8)),
});
export type PairingPayload = typeof PairingPayload.Type;

export const PairingAbortReason = Schema.Literals([
  "cancelled",
  "conflict",
  "codeMismatch",
  "timeout",
]);
export type PairingAbortReason = typeof PairingAbortReason.Type;

const Abort = Schema.Struct({
  t: Schema.Literal("abort"),
  reason: PairingAbortReason,
});

/** Decoded per direction, so a message of the other one is dropped. */
export const ToOfferingDevice = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({
      t: Schema.Literal("hello"),
      proof: Hex(32),
      // An older Finito sends none; a malformed one is dropped, not the hello.
      deviceId: Schema.optional(Schema.Unknown),
    }),
    Schema.Struct({ t: Schema.Literal("ack") }),
    Abort,
  ]),
);

export const ToJoiningDevice = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ t: Schema.Literal("ready") }),
    // Validated on its own: a payload that fails ends the session, unlike a
    // message that does not decode at all.
    Schema.Struct({ t: Schema.Literal("payload"), data: Schema.Unknown }),
    Abort,
  ]),
);

export type PairingMessage =
  | {
      readonly t: "hello";
      readonly proof: string;
      readonly deviceId?: string;
    }
  | { readonly t: "ready" }
  | { readonly t: "payload"; readonly data: PairingPayload }
  | { readonly t: "ack" }
  | { readonly t: "abort"; readonly reason: PairingAbortReason };
