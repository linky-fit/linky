import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/ciphers/utils.js";
import { Option, Schema } from "effect";
import { BoltCardId } from "./card";

// One WebSocket per card session: the bridge forwards each POS request as a
// numbered message and the card answers it with the same `id`.

const Hex = (length: number) =>
  Schema.String.pipe(Schema.pattern(new RegExp(`^[0-9a-fA-F]{${length}}$`)));

const RequestId = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64));
const Reason = Schema.String.pipe(Schema.maxLength(200));
const Msat = Schema.Int.pipe(Schema.positive());

/** Sent by the bridge right after the socket opens. */
export const BridgeChallenge = Schema.TaggedStruct("challenge", {
  challenge: Hex(64),
});
export type BridgeChallenge = typeof BridgeChallenge.Type;

/** The card is authenticated and receives requests from now on. */
export const BridgeReady = Schema.TaggedStruct("ready", {});
export type BridgeReady = typeof BridgeReady.Type;

/** A POS opened the card URL; the card answers with an offer or a rejection. */
export const BridgeWithdraw = Schema.TaggedStruct("withdraw", {
  id: RequestId,
  p: Hex(32),
  c: Hex(16),
});
export type BridgeWithdraw = typeof BridgeWithdraw.Type;

/** A POS sent its invoice to the LNURL callback. */
export const BridgeCallback = Schema.TaggedStruct("callback", {
  id: RequestId,
  k1: Hex(64),
  pr: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(5_000)),
});
export type BridgeCallback = typeof BridgeCallback.Type;

export const BridgeMessage = Schema.Union(
  BridgeChallenge,
  BridgeReady,
  BridgeWithdraw,
  BridgeCallback,
);
export type BridgeMessage = typeof BridgeMessage.Type;

export const CardAuth = Schema.TaggedStruct("auth", {
  cardId: BoltCardId,
  signature: Hex(128),
});
export type CardAuth = typeof CardAuth.Type;

/** Answers `withdraw` with the LUD-03 withdrawRequest fields the card sets. */
export const CardOffer = Schema.TaggedStruct("offer", {
  id: RequestId,
  k1: Hex(64),
  minWithdrawable: Msat,
  maxWithdrawable: Msat,
  defaultDescription: Reason,
});
export type CardOffer = typeof CardOffer.Type;

/** Answers `callback`: the card took the invoice and pays it itself. */
export const CardAccepted = Schema.TaggedStruct("accepted", { id: RequestId });
export type CardAccepted = typeof CardAccepted.Type;

/** Answers either request; the bridge passes `reason` to the POS. */
export const CardRejected = Schema.TaggedStruct("rejected", {
  id: RequestId,
  reason: Reason,
});
export type CardRejected = typeof CardRejected.Type;

export const CardMessage = Schema.Union(
  CardAuth,
  CardOffer,
  CardAccepted,
  CardRejected,
);
export type CardMessage = typeof CardMessage.Type;

const decodeBridgeMessageOption = Schema.decodeUnknownOption(
  Schema.parseJson(BridgeMessage),
);
const decodeCardMessageOption = Schema.decodeUnknownOption(
  Schema.parseJson(CardMessage),
);

export const decodeBridgeMessage = (text: string): BridgeMessage | null =>
  Option.getOrNull(decodeBridgeMessageOption(text));

export const decodeCardMessage = (text: string): CardMessage | null =>
  Option.getOrNull(decodeCardMessageOption(text));

export const encodeBridgeMessage = (message: BridgeMessage): string =>
  JSON.stringify(message);

export const encodeCardMessage = (message: CardMessage): string =>
  JSON.stringify(message);

// Domain-separated so a card key never signs anything that could pass as a
// signature in another protocol.
const authDigest = (challenge: string): Uint8Array =>
  sha256(utf8ToBytes(`linky-bolt-card-bridge:${challenge.toLowerCase()}`));

export const signBridgeChallenge = (
  secretKey: Uint8Array,
  challenge: string,
): string => bytesToHex(schnorr.sign(authDigest(challenge), secretKey));

export const verifyBridgeChallenge = (
  cardId: BoltCardId,
  challenge: string,
  signature: string,
): boolean => {
  try {
    return schnorr.verify(
      hexToBytes(signature),
      authDigest(challenge),
      hexToBytes(cardId),
    );
  } catch {
    return false;
  }
};
