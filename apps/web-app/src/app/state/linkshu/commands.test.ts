// @vitest-environment jsdom
import {
  Bip39Seed,
  linkshuServices,
  makeInMemoryProofStore,
  NewProof,
  ProofStore,
} from "@linky-fit/linkshu";
import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { normalizeMintUrl } from "../../../utils/mint";
import { storedSourceMint } from "./commands";

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
