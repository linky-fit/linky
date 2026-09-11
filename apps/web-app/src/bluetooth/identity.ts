import {
  encodeNpub,
  parsePubkey,
  type NostrSecretKey,
  type Pubkey,
} from "@linky/linkstr";
import { schnorr } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { Schema } from "effect";

const Hex32 = Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const MeshId = Schema.String.pipe(Schema.pattern(/^[a-f0-9]{16}$/));
const Challenge = Schema.Struct({
  type: Schema.Literal("challenge"),
  nonce: Hex32,
  requester: MeshId,
});
const Proof = Schema.Struct({
  type: Schema.Literal("proof"),
  nonce: Hex32,
  requester: MeshId,
  meshId: MeshId,
  pubkey: Hex32,
  name: Schema.String.pipe(Schema.maxLength(255)),
  signature: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{128}$/)),
});
const IdentityPacket = Schema.Union(Challenge, Proof);
export type IdentityPacket = typeof IdentityPacket.Type;
export type IdentityProof = typeof Proof.Type;

export interface NearbyIdentity {
  pubkey: Pubkey;
  npub: string;
  name: string;
  meshId: string;
}

export const newIdentityChallenge = (
  requester: string,
): typeof Challenge.Type => ({
  type: "challenge",
  nonce: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
  requester,
});

const proofDigest = (proof: Omit<IdentityProof, "type" | "signature">) =>
  sha256(
    new TextEncoder().encode(
      JSON.stringify([
        "linky.bluetooth.identity.v1",
        proof.nonce,
        proof.requester,
        proof.meshId,
        proof.pubkey,
        proof.name,
      ]),
    ),
  );

export const createIdentityProof = (
  challenge: typeof Challenge.Type,
  identity: { pubkey: Pubkey; secretKey: NostrSecretKey },
  meshId: string,
  name: string,
): IdentityProof => {
  const body = {
    nonce: challenge.nonce,
    requester: challenge.requester,
    meshId,
    pubkey: identity.pubkey,
    name,
  };
  return {
    ...body,
    type: "proof",
    signature: bytesToHex(schnorr.sign(proofDigest(body), identity.secretKey)),
  };
};

export const verifyIdentityProof = (
  proof: IdentityProof,
  challenge: typeof Challenge.Type,
): NearbyIdentity | null => {
  if (
    proof.nonce !== challenge.nonce ||
    proof.requester !== challenge.requester
  )
    return null;
  const pubkey = parsePubkey(proof.pubkey);
  if (!pubkey) return null;
  try {
    if (!schnorr.verify(proof.signature, proofDigest(proof), pubkey))
      return null;
    return {
      pubkey,
      npub: encodeNpub(pubkey),
      name: proof.name,
      meshId: proof.meshId,
    };
  } catch {
    return null;
  }
};

export const decodeIdentityPacket = (
  bytes: Uint8Array,
): IdentityPacket | null => {
  if (bytes.length > 2048) return null;
  try {
    return Schema.decodeUnknownSync(Schema.parseJson(IdentityPacket))(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    return null;
  }
};

// This framing belongs only to Linky's separate GATT characteristic.
export const frameIdentityPacket = (
  packet: IdentityPacket,
  mtu: number,
): Uint8Array[] => {
  const bytes = new TextEncoder().encode(JSON.stringify(packet));
  if (bytes.length > 2048 || mtu < 20)
    throw new Error("Bluetooth identity frame too large");
  const transfer = crypto.getRandomValues(new Uint8Array(2));
  const frames: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += mtu - 7) {
    const body = bytes.slice(offset, offset + mtu - 7);
    const frame = new Uint8Array(7 + body.length);
    const view = new DataView(frame.buffer);
    frame[0] = 0x4c;
    frame.set(transfer, 1);
    view.setUint16(3, offset);
    view.setUint16(5, bytes.length);
    frame.set(body, 7);
    frames.push(frame);
  }
  return frames;
};

export class IdentityAssembler {
  private pending: {
    id: number;
    bytes: Uint8Array;
    offset: number;
    at: number;
  } | null = null;

  receive(frame: Uint8Array, now = Date.now()): IdentityPacket | null {
    if (frame.length < 8 || frame[0] !== 0x4c) return null;
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const id = view.getUint16(1);
    const offset = view.getUint16(3);
    const total = view.getUint16(5);
    if (total < 1 || total > 2048 || offset + frame.length - 7 > total)
      return null;
    if (offset === 0)
      this.pending = { id, bytes: new Uint8Array(total), offset: 0, at: now };
    const pending = this.pending;
    if (
      !pending ||
      pending.id !== id ||
      pending.offset !== offset ||
      pending.bytes.length !== total ||
      now - pending.at > 10_000
    ) {
      this.pending = null;
      return null;
    }
    pending.bytes.set(frame.subarray(7), offset);
    pending.offset += frame.length - 7;
    if (pending.offset !== total) return null;
    this.pending = null;
    return decodeIdentityPacket(pending.bytes);
  }
}
