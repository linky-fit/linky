import { describe, expect, it } from "vitest";
import { makeIdentity } from "@linky/linkstr/testing";
import {
  createIdentityProof,
  decodeIdentityPacket,
  frameIdentityPacket,
  IdentityAssembler,
  newIdentityChallenge,
  verifyIdentityProof,
} from "./identity";

describe("Bluetooth identity proof", () => {
  it("binds the key, nickname, and both peers to a fresh challenge", () => {
    const identity = makeIdentity();
    const challenge = newIdentityChallenge("0123456789abcdef");
    const proof = createIdentityProof(
      challenge,
      identity,
      "abcdef0123456789",
      "Alice",
    );
    expect(verifyIdentityProof(proof, challenge)?.pubkey).toBe(identity.pubkey);
    expect(verifyIdentityProof(proof, challenge)).not.toHaveProperty("name");
    expect(
      verifyIdentityProof({ ...proof, name: "Someone else" }, challenge),
    ).toBeNull();
    expect(
      verifyIdentityProof({ ...proof, meshId: "1111111111111111" }, challenge),
    ).toBeNull();
    expect(
      verifyIdentityProof(
        { ...proof, pubkey: makeIdentity().pubkey },
        challenge,
      ),
    ).toBeNull();
    expect(
      verifyIdentityProof(proof, newIdentityChallenge(challenge.requester)),
    ).toBeNull();
    expect(
      verifyIdentityProof(proof, {
        ...challenge,
        requester: "1111111111111111",
      }),
    ).toBeNull();
  });

  it("reassembles an authenticated proof at the minimum BLE MTU", () => {
    const challenge = newIdentityChallenge("0123456789abcdef");
    const proof = createIdentityProof(
      challenge,
      makeIdentity(),
      "abcdef0123456789",
      "Žaneta",
    );
    const frames = frameIdentityPacket(proof, 20);
    const assembler = new IdentityAssembler();
    let decoded;
    for (const frame of frames) {
      expect(frame.length).toBeLessThanOrEqual(20);
      decoded = assembler.receive(frame);
    }
    expect(decoded).toEqual(proof);
    expect(frames.length).toBeGreaterThan(20);
  });

  it("rejects reordered, stale, oversized, and malformed identity traffic", () => {
    const frames = frameIdentityPacket(
      newIdentityChallenge("0123456789abcdef"),
      20,
    );
    const first = frames[0];
    const second = frames[1];
    const third = frames[2];
    if (!first || !second || !third)
      throw new Error("Expected fragmented identity");
    const assembler = new IdentityAssembler();
    expect(assembler.receive(first, 0)).toBeNull();
    expect(assembler.receive(second, 11000)).toBeNull();
    expect(assembler.receive(first)).toBeNull();
    expect(assembler.receive(third)).toBeNull();
    expect(assembler.receive(second)).toBeNull();
    expect(decodeIdentityPacket(new Uint8Array(2049))).toBeNull();
    expect(
      decodeIdentityPacket(new TextEncoder().encode('{"type":"proof"}')),
    ).toBeNull();
  });
});
