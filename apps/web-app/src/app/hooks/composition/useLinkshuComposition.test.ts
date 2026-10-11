// @vitest-environment jsdom
import { assert, describe, expect, it } from "vitest";
import {
  Bip39Seed,
  linkshuServices,
  makeInMemoryProofStore,
  NewProof,
  p2pkPubkeyOf,
  parseP2pkPubkey,
  ProofStore,
} from "@linky-fit/linkshu";
import { encodeNpub, encodeNsec } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { Effect, Layer, Schema } from "effect";
import { normalizeMintUrl } from "../../../utils/mint";
import { nostrKeyOptionsOf, storedSourceMint } from "./useLinkshuComposition";

const xOnly = (pubkey: string) => pubkey.slice(2);

describe("nostrKeyOptionsOf", () => {
  it("unlocks tokens locked to the user's npub with the nostr key", () => {
    const identity = makeIdentity();
    const { unlockOptions } = nostrKeyOptionsOf(encodeNsec(identity.secretKey));
    const lockTo = parseP2pkPubkey(encodeNpub(identity.pubkey));

    assert("unlockingKey" in unlockOptions && lockTo !== null);
    expect(xOnly(p2pkPubkeyOf(unlockOptions.unlockingKey))).toBe(xOnly(lockTo));
  });

  it("gives no keys without a decodable nsec", () => {
    const none = { lockingOptions: {}, unlockOptions: {} };
    expect(nostrKeyOptionsOf(null)).toEqual(none);
    expect(nostrKeyOptionsOf("nsec1invalid")).toEqual(none);
  });
});

describe("storedSourceMint", () => {
  it.each(["https://Mint.Example.com", "https://mint.minibits.cash"])(
    "reads %s back from the app's spelling of the mint",
    async (storedMint) => {
      const proofs = makeInMemoryProofStore();
      Effect.runSync(
        proofs.insert([
          Schema.decodeUnknownSync(NewProof)({
            mint: storedMint,
            unit: "sat",
            keysetId: "009a1f293253e41e",
            amount: 64,
            secret: `secret-${storedMint}`,
            C: "02" + "ab".repeat(32),
            dleq: null,
            state: "available",
            operationId: null,
          }),
        ]),
      );
      const appSpelling = normalizeMintUrl(storedMint);
      expect(appSpelling).not.toBe(storedMint);

      const source = await Effect.runPromise(
        storedSourceMint(appSpelling).pipe(
          Effect.provide(
            linkshuServices({
              bip39Seed: Bip39Seed.make(new Uint8Array(64)),
              proofStore: Layer.succeed(ProofStore, proofs),
            }),
          ),
        ),
      );

      expect(source).toBe(storedMint);
    },
  );
});
