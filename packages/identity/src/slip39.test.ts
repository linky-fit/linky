import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { IdentityProvider } from "./IdentityProvider";
import { MasterSecretProvider } from "./MasterSecretProvider";
import {
  createSlip39Share,
  looksLikeSlip39Share,
  parseSlip39Share,
  recoverMasterSecretFromSlip39Share,
  recoverMasterSecretFromSlip39Shares,
} from "./slip39";

const runIdentity = <E>(
  masterSecretLayer: Layer.Layer<MasterSecretProvider, E>,
) =>
  Effect.runPromise(
    Effect.provide(
      IdentityProvider,
      Layer.provideMerge(IdentityProvider.Live, masterSecretLayer),
    ),
  );

describe("SLIP-39", () => {
  it("generates a share that parses back as one", async () => {
    const share = await Effect.runPromise(createSlip39Share());
    expect(looksLikeSlip39Share(share)).toBe(true);
    expect(await Effect.runPromise(parseSlip39Share(share))).toBe(share);
  });

  it("rejects invalid slip39 shares", async () => {
    await expect(
      Effect.runPromise(parseSlip39Share("not a valid slip39 share")),
    ).rejects.toThrow();
  });

  it("recovers a valid master secret from generated share", async () => {
    const share = await Effect.runPromise(createSlip39Share());
    const parsed = await Effect.runPromise(parseSlip39Share(share));
    const single = await Effect.runPromise(
      recoverMasterSecretFromSlip39Share(parsed),
    );
    const many = await Effect.runPromise(
      recoverMasterSecretFromSlip39Shares([parsed]),
    );
    expect(single).toBeInstanceOf(Uint8Array);
    expect(single.length).toBeGreaterThanOrEqual(16);
    expect(single.length).toBeLessThanOrEqual(64);
    expect(single).toEqual(many);
  });

  it("rejects empty slip39 share arrays", async () => {
    await expect(
      Effect.runPromise(recoverMasterSecretFromSlip39Shares([])),
    ).rejects.toThrow();
  });

  it("derives the same identity from a share pasted with case and spacing noise", async () => {
    const share = await Effect.runPromise(createSlip39Share());
    const noisy = `  ${share
      .split(/\s+/)
      .map((word) => word.toUpperCase())
      .join("   ")}  `;

    const clean = await runIdentity(
      MasterSecretProvider.fromSlip39Share(
        await Effect.runPromise(parseSlip39Share(share)),
      ),
    );
    const fromNoisy = await runIdentity(
      MasterSecretProvider.fromSlip39Share(
        await Effect.runPromise(parseSlip39Share(noisy)),
      ),
    );

    expect(fromNoisy.nostrPublicKey).toBe(clean.nostrPublicKey);
    expect(fromNoisy.nostrSigningKey).toEqual(clean.nostrSigningKey);
    expect(fromNoisy.cashuWalletSeed).toEqual(clean.cashuWalletSeed);
    expect(fromNoisy.storageMetaOwnerKey).toEqual(clean.storageMetaOwnerKey);
  });
});
