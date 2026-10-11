import { assert, describe, expect, it } from "vitest";
import {
  Bip39Seed,
  KeyValueStore,
  linkshuServices,
  makeInMemoryKeyValueStore,
  makeInMemoryOperationStore,
  makeInMemoryProofStore,
  NewProof,
  OperationStore,
  p2pkPubkeyOf,
  parseP2pkPubkey,
  ProofStore,
} from "@linky-fit/linkshu";
import { encodeNpub, encodeNsec } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { Effect, Layer, Schema } from "effect";
import { normalizeMintUrl } from "../../../utils/mint";
import { autoswapDraftOf, nostrKeyOptionsOf } from "./useLinkshuComposition";

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

describe("autoswapDraftOf", () => {
  const counterKey = (mint: string) =>
    `linkshu.detCounter.${encodeURIComponent(mint)}.sat.009a1f293253e41e`;

  const walletHolding = (storedMint: string) => {
    const kv = makeInMemoryKeyValueStore();
    const proofs = makeInMemoryProofStore();
    const operations = makeInMemoryOperationStore();
    const layer = linkshuServices({
      bip39Seed: Bip39Seed.make(new Uint8Array(64)),
      keyValueStore: Layer.succeed(KeyValueStore, kv),
      proofStore: Layer.succeed(ProofStore, proofs),
      operationStore: Layer.succeed(OperationStore, operations),
    });
    const snapshot = Effect.all({
      keys: kv.listKeys(""),
      counter: kv.get(counterKey(storedMint)),
      proofs: proofs.loadAll,
      operations: operations.loadAll,
    });
    Effect.runSync(
      Effect.andThen(
        kv.set(counterKey(storedMint), "7"),
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
      ),
    );
    return { layer, snapshot };
  };

  it.each(["https://Mint.Example.com", "https://mint.minibits.cash"])(
    "moves %s's funds when the app names the mint by its own spelling",
    async (storedMint) => {
      const { layer, snapshot } = walletHolding(storedMint);
      const before = Effect.runSync(snapshot);

      const draft = await Effect.runPromise(
        autoswapDraftOf({
          sourceMint: normalizeMintUrl(storedMint),
          targetMint: "https://cashu.cz",
        }).pipe(Effect.provide(layer)),
      );

      expect(normalizeMintUrl(storedMint)).not.toBe(storedMint);
      expect(draft.sourceMint).toBe(storedMint);
      expect(draft.targetMint).toBe("https://cashu.cz");
      // Resolving the source neither moves funds nor re-keys counters.
      expect(Effect.runSync(snapshot)).toEqual(before);
      expect(before.counter).toBe("7");
    },
  );
});
