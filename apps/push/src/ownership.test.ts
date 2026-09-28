import {
  derivePubkey,
  makePushOwnershipProof,
  NostrSecretKey,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { describe, expect, it } from "bun:test";

import { signPlainEvent } from "../../../packages/linkstr/src/internal/plainEvent";

import { RequestError } from "./guards";
import { OwnershipVerifier } from "./ownership";
import type { ChallengeRecord, ProofAction } from "./types";

const secretKey = NostrSecretKey.make(new Uint8Array(32).fill(1));
const pubkey = derivePubkey(secretKey);
const nowSeconds = UnixSeconds.make(1_754_000_000);
const nowMs = nowSeconds * 1000;

const challengeFor = (action: ProofAction): ChallengeRecord => ({
  nonce: "challenge-1",
  pubkey,
  action,
  expiresAt: nowMs + 60_000,
  usedAt: null,
});

const captureRequestError = (run: () => void): RequestError => {
  try {
    run();
  } catch (error) {
    if (error instanceof RequestError) return error;
    throw error;
  }
  throw new Error("Expected RequestError");
};

const verifyProofError = (event: unknown): RequestError => {
  const challenge = challengeFor("subscribe");
  const verifier = new OwnershipVerifier({
    proofMaxAgeSeconds: 60,
    loadChallenge: () => challenge,
  });
  return captureRequestError(() =>
    verifier.verifyProofs("subscribe", [pubkey], [{ pubkey, event }], nowMs),
  );
};

describe("OwnershipVerifier", () => {
  it("accepts proofs produced by linkstr's shared codec", () => {
    const challenge = challengeFor("subscribe");
    const verifier = new OwnershipVerifier({
      proofMaxAgeSeconds: 60,
      loadChallenge: (nonce) => (nonce === challenge.nonce ? challenge : null),
    });
    const event = makePushOwnershipProof(
      { action: "subscribe", challenge: challenge.nonce },
      secretKey,
      nowSeconds,
    );

    expect(
      verifier.verifyProofs("subscribe", [pubkey], [{ pubkey, event }], nowMs),
    ).toEqual([challenge.nonce]);
  });

  it("rejects a proof for a different requested action", () => {
    const challenge = challengeFor("unsubscribe");
    const verifier = new OwnershipVerifier({
      proofMaxAgeSeconds: 60,
      loadChallenge: () => challenge,
    });
    const event = makePushOwnershipProof(
      { action: "unsubscribe", challenge: challenge.nonce },
      secretKey,
      nowSeconds,
    );

    expect(() =>
      verifier.verifyProofs("subscribe", [pubkey], [{ pubkey, event }], nowMs),
    ).toThrow(RequestError);
  });

  it("maps a non-hex signature to a malformed 400 response", () => {
    const event = makePushOwnershipProof(
      { action: "subscribe", challenge: "challenge-1" },
      secretKey,
      nowSeconds,
    );

    expect(verifyProofError({ ...event, sig: "not-hex" })).toMatchObject({
      status: 400,
      code: "invalid_proof",
      message: "Ownership proof event is malformed",
    });
  });

  it("maps a duplicated pubkey tag to a structural 400 response", () => {
    const event = makePushOwnershipProof(
      { action: "subscribe", challenge: "challenge-1" },
      secretKey,
      nowSeconds,
    );
    const duplicatePubkey = signPlainEvent(
      {
        kind: event.kind,
        tags: [...event.tags, ["pubkey", event.pubkey]],
        content: event.content,
      },
      nowSeconds,
      secretKey,
    );

    expect(verifyProofError(duplicatePubkey)).toMatchObject({
      status: 400,
      code: "invalid_proof",
      message: "Proof pubkey tag must appear exactly once",
    });
  });

  it("maps a mismatched pubkey tag to a 401 response", () => {
    const event = makePushOwnershipProof(
      { action: "subscribe", challenge: "challenge-1" },
      secretKey,
      nowSeconds,
    );
    const mismatchedPubkey = signPlainEvent(
      {
        kind: event.kind,
        tags: event.tags.map((tag) =>
          tag[0] === "pubkey"
            ? [
                "pubkey",
                derivePubkey(NostrSecretKey.make(new Uint8Array(32).fill(2))),
              ]
            : tag,
        ),
        content: event.content,
      },
      nowSeconds,
      secretKey,
    );

    expect(verifyProofError(mismatchedPubkey)).toMatchObject({
      status: 401,
      code: "invalid_proof",
      message: "Proof pubkey tag does not match event pubkey",
    });
  });

  it("maps a valid-hex incorrect signature to a 401 response", () => {
    const event = makePushOwnershipProof(
      { action: "subscribe", challenge: "challenge-1" },
      secretKey,
      nowSeconds,
    );

    expect(verifyProofError({ ...event, sig: "00".repeat(64) })).toMatchObject({
      status: 401,
      code: "invalid_proof",
      message: "Proof signature is invalid",
    });
  });
});
