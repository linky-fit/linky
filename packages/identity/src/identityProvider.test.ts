import {
  decodeNpub,
  decodeNsec,
  encodeNpub,
  encodeNsec,
} from "@linky-fit/linkstr";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdentityProvider, IdentityProviderError } from "./IdentityProvider";
import { MasterSecretProvider } from "./MasterSecretProvider";
import { MasterSecret } from "./domain";

const hex = (u8: Uint8Array) => Buffer.from(u8).toString("hex");

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
} as const;

const testLayer = Layer.provideMerge(
  IdentityProvider.layer,
  Layer.succeed(MasterSecretProvider, TEST_SEED),
);

const runTest = <A>(
  effect: Effect.Effect<A, IdentityProviderError, IdentityProvider>,
) => Effect.runPromise(Effect.provide(effect, testLayer));

describe("IdentityProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("derives exact expected keys from test seed (regression guard)", async () => {
    const id = await runTest(IdentityProvider);

    expect(hex(id.nostrSigningKey)).toBe(EXPECTED.nostrSigningKey);
    expect(id.nostrPublicKey).toBe(EXPECTED.nostrPublicKey);
    expect(hex(await Effect.runPromise(id.cashuWalletSeed))).toBe(
      EXPECTED.cashuWalletSeed,
    );
  });

  it("lazily derives and caches cashuWalletSeed so Nostr-only callers skip PBKDF2", async () => {
    const deriveBits = vi.spyOn(globalThis.crypto.subtle, "deriveBits");

    const id = await runTest(IdentityProvider);
    expect(deriveBits).not.toHaveBeenCalled();

    const first = await Effect.runPromise(id.cashuWalletSeed);
    expect(deriveBits).toHaveBeenCalledTimes(1);

    const second = await Effect.runPromise(id.cashuWalletSeed);
    expect(deriveBits).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
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
