import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdentityProvider } from "./IdentityProvider";
import { MasterSecretProvider } from "./MasterSecretProvider";
import { createSlip39Share, parseSlip39Share } from "./slip39";

const { pureJsPbkdf2 } = vi.hoisted(() => ({
  pureJsPbkdf2: () => {
    throw new Error("pure-JS PBKDF2 called");
  },
}));
vi.mock("@noble/hashes/pbkdf2.js", () => ({
  pbkdf2: pureJsPbkdf2,
  pbkdf2Async: pureJsPbkdf2,
}));
vi.mock("@scure/bip39", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@scure/bip39")>()),
  mnemonicToSeed: pureJsPbkdf2,
  mnemonicToSeedSync: pureJsPbkdf2,
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("key derivation", () => {
  it("runs every PBKDF2 on WebCrypto", async () => {
    const share = await Effect.runPromise(
      createSlip39Share().pipe(Effect.flatMap(parseSlip39Share)),
    );
    const deriveBits = vi.spyOn(globalThis.crypto.subtle, "deriveBits");

    await Effect.runPromise(
      Effect.provide(
        IdentityProvider,
        Layer.provideMerge(
          IdentityProvider.layer,
          MasterSecretProvider.fromSlip39Share(share),
        ),
      ),
    );

    const algorithms = deriveBits.mock.calls.map(([algorithm]) => algorithm);
    for (const algorithm of algorithms) {
      expect(algorithm).toMatchObject({ name: "PBKDF2" });
    }
    expect(algorithms).toContainEqual(
      expect.objectContaining({ hash: "SHA-512", iterations: 2048 }),
    );
  });
});
