import { decodeNpub, decodeNsec, encodeNpub, encodeNsec } from "@linky/linkstr";
import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { IdentityProvider, IdentityProviderError } from "./IdentityProvider";
import { MasterSecretProvider } from "./MasterSecretProvider";
import { MasterSecret, OwnerLaneIndex } from "./domain";

const hex = (u8: Uint8Array) => Buffer.from(u8).toString("hex");
const lane = (index: number): OwnerLaneIndex =>
  Schema.decodeUnknownSync(OwnerLaneIndex)(index);

/** Deterministic 64-byte master seed for testing. */
const TEST_SEED = MasterSecret.make(
  new Uint8Array(Array.from({ length: 64 }, (_, i) => (i + 1) % 256)),
);

/**
 * Known-good derivation output for TEST_SEED.
 * If any value here changes, the derivation logic has regressed.
 */
const EXPECTED = {
  nostrSigningKey:
    "6467093d4ff55fb8d8158d578a44bb984a62513b9043b2d2ff8fc0820be877c7",
  nostrPublicKey:
    "b402852069fe3caa7a74c19f5f8a363c9d0d6d1ae7b4acc7c5798aefd443d773",
  cashuWalletSeed:
    "79f289bb2ed0276d7f5ac120d499b46d6da6f181c030c3a3891e5c5eeacc1265b45791f7922816cf4bf685d12659f0c62a41c044d0a835a6de482ab4c5a7b4a4",
  storageMetaOwnerKey: "3085ed4fab471db8691a7aa38358779a",
  storageContactsOwnerKey0: "8f6072f2aab734bf3686fee0850f8745",
  storageContactsOwnerKey1: "f2895760c0d8b39f6478b8052bb57abd",
  storageCashuOwnerKey0: "c36e8b8f44512393ed3158c302f3e8b7",
  storageCashuOwnerKey1: "1371639e7119e3a1e3c02aba9a494eb9",
  storageMessagesOwnerKey0: "54c22ce286e79d6f580d569d443e4a8c",
  storageMessagesOwnerKey1: "5457f8344ed636177013e64144a20090",
  storageTransactionsOwnerKey0: "a6ce5d7e745db50747d4999661c85d7b",
  storageTransactionsOwnerKey1: "7a6c62e84719fb5b0ece4a4807853cd0",
  storageIdentityOwnerKey: "8a48493e2a52d923b01666897957fe52",
} as const;

const testLayer = Layer.provideMerge(
  IdentityProvider.Live,
  Layer.succeed(MasterSecretProvider, TEST_SEED),
);

const runTest = <A>(
  effect: Effect.Effect<A, IdentityProviderError, IdentityProvider>,
) => Effect.runPromise(Effect.provide(effect, testLayer));

describe("IdentityProvider", () => {
  it("derives exact expected keys from test seed (regression guard)", async () => {
    const id = await runTest(IdentityProvider);

    expect(hex(id.nostrSigningKey)).toBe(EXPECTED.nostrSigningKey);
    expect(id.nostrPublicKey).toBe(EXPECTED.nostrPublicKey);
    expect(hex(id.cashuWalletSeed)).toBe(EXPECTED.cashuWalletSeed);
    expect(hex(id.storageMetaOwnerKey)).toBe(EXPECTED.storageMetaOwnerKey);
    expect(hex(id.storageContactsOwnerKey(lane(0)))).toBe(
      EXPECTED.storageContactsOwnerKey0,
    );
    expect(hex(id.storageContactsOwnerKey(lane(1)))).toBe(
      EXPECTED.storageContactsOwnerKey1,
    );
    expect(hex(id.storageCashuOwnerKey(lane(0)))).toBe(
      EXPECTED.storageCashuOwnerKey0,
    );
    expect(hex(id.storageCashuOwnerKey(lane(1)))).toBe(
      EXPECTED.storageCashuOwnerKey1,
    );
    expect(hex(id.storageMessagesOwnerKey(lane(0)))).toBe(
      EXPECTED.storageMessagesOwnerKey0,
    );
    expect(hex(id.storageMessagesOwnerKey(lane(1)))).toBe(
      EXPECTED.storageMessagesOwnerKey1,
    );
    expect(hex(id.storageTransactionsOwnerKey(lane(0)))).toBe(
      EXPECTED.storageTransactionsOwnerKey0,
    );
    expect(hex(id.storageTransactionsOwnerKey(lane(1)))).toBe(
      EXPECTED.storageTransactionsOwnerKey1,
    );
    expect(hex(id.storageIdentityOwnerKey)).toBe(
      EXPECTED.storageIdentityOwnerKey,
    );
  });

  it("encodes valid bech32 nsec/npub", async () => {
    const identity = await runTest(IdentityProvider);

    const nsec = encodeNsec(identity.nostrSigningKey);
    const npub = encodeNpub(identity.nostrPublicKey);

    expect(decodeNsec(nsec)).toEqual(identity.nostrSigningKey);
    expect(decodeNpub(npub)).toBe(identity.nostrPublicKey);
    expect(nsec.startsWith("nsec1")).toBe(true);
    expect(npub.startsWith("npub1")).toBe(true);
  });
});
