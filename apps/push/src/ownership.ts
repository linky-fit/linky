import { verifyPushOwnershipProof } from "@linky-fit/linkstr";
import type { PushOwnershipProofFailure } from "@linky-fit/linkstr";

import { RequestError } from "./guards";
import type {
  ChallengeRecord,
  OwnershipProofInput,
  ProofAction,
} from "./types";

interface OwnershipVerifierOptions {
  proofMaxAgeSeconds: number;
  loadChallenge: (nonce: string) => ChallengeRecord | null;
}

const failureResponses: Record<
  PushOwnershipProofFailure,
  { readonly status: number; readonly message: string }
> = {
  "malformed-event": {
    status: 400,
    message: "Ownership proof event is malformed",
  },
  "invalid-signature": {
    status: 401,
    message: "Proof signature is invalid",
  },
  "wrong-kind": {
    status: 400,
    message: "Ownership proof event kind is invalid",
  },
  "invalid-challenge": {
    status: 400,
    message: "Proof challenge tag must appear exactly once and be non-empty",
  },
  "invalid-action": {
    status: 400,
    message: "Proof action tag must appear exactly once and be valid",
  },
  "invalid-pubkey-tag": {
    status: 400,
    message: "Proof pubkey tag must appear exactly once",
  },
  "invalid-pubkey": {
    status: 401,
    message: "Proof pubkey tag does not match event pubkey",
  },
  "wrong-content": {
    status: 400,
    message: "Ownership proof content is invalid",
  },
};

export class OwnershipVerifier {
  private readonly proofMaxAgeSeconds: number;
  private readonly loadChallenge: (nonce: string) => ChallengeRecord | null;

  constructor(options: OwnershipVerifierOptions) {
    this.proofMaxAgeSeconds = options.proofMaxAgeSeconds;
    this.loadChallenge = options.loadChallenge;
  }

  verifyProofs(
    action: ProofAction,
    recipientPubkeys: string[],
    proofs: OwnershipProofInput[],
    nowMs: number,
  ): string[] {
    const requestedPubkeys = new Set(recipientPubkeys);
    const proofByPubkey = new Map<string, OwnershipProofInput>();

    for (const proof of proofs) {
      if (!requestedPubkeys.has(proof.pubkey)) {
        throw new RequestError(
          400,
          "invalid_proof",
          `Unexpected proof provided for pubkey ${proof.pubkey}`,
        );
      }
      if (proofByPubkey.has(proof.pubkey)) {
        throw new RequestError(
          400,
          "invalid_proof",
          `Duplicate proof provided for pubkey ${proof.pubkey}`,
        );
      }
      proofByPubkey.set(proof.pubkey, proof);
    }

    const challengeNonces: string[] = [];
    const nowSeconds = Math.floor(nowMs / 1000);

    for (const pubkey of recipientPubkeys) {
      const proof = proofByPubkey.get(pubkey);
      if (!proof) {
        throw new RequestError(
          400,
          "invalid_proof",
          `Missing proof for pubkey ${pubkey}`,
        );
      }

      const decoded = verifyPushOwnershipProof(proof.event);
      if (decoded._tag === "Failure") {
        const response = failureResponses[decoded.failure];
        throw new RequestError(
          response.status,
          "invalid_proof",
          response.message,
        );
      }
      const verified = decoded.success;

      if (verified.event.pubkey !== pubkey) {
        throw new RequestError(
          401,
          "invalid_proof",
          `Proof event pubkey does not match requested pubkey ${pubkey}`,
        );
      }
      if (verified.action !== action) {
        throw new RequestError(
          401,
          "invalid_proof",
          `Proof action tag must be ${action}`,
        );
      }
      if (
        Math.abs(nowSeconds - verified.event.created_at) >
        this.proofMaxAgeSeconds
      ) {
        throw new RequestError(
          401,
          "invalid_proof",
          `Proof event for ${pubkey} is outside the allowed time window`,
        );
      }

      const storedChallenge = this.loadChallenge(verified.challenge);
      if (!storedChallenge) {
        throw new RequestError(
          401,
          "invalid_proof",
          "Challenge was not issued by this server",
        );
      }
      if (storedChallenge.pubkey !== pubkey) {
        throw new RequestError(
          401,
          "invalid_proof",
          "Challenge pubkey does not match the requested pubkey",
        );
      }
      if (storedChallenge.action !== action) {
        throw new RequestError(
          401,
          "invalid_proof",
          "Challenge action does not match the request action",
        );
      }
      if (storedChallenge.expiresAt <= nowMs) {
        throw new RequestError(401, "invalid_proof", "Challenge has expired");
      }
      if (storedChallenge.usedAt !== null) {
        throw new RequestError(
          401,
          "invalid_proof",
          "Challenge has already been used",
        );
      }

      challengeNonces.push(verified.challenge);
    }

    return challengeNonces;
  }
}
