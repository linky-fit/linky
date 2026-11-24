import { Effect, Layer } from "effect";
import { Slip39 } from "slip39-ts";
import { describe, expect, it, vi } from "vitest";
import { IdentityProvider } from "./IdentityProvider";
import { MasterSecretProvider } from "./MasterSecretProvider";
import {
  createSlip39Share,
  looksLikeSlip39Share,
  parseSlip39Share,
  recoverMasterSecretFromSlip39Share,
  recoverMasterSecretFromSlip39Shares,
  slip39ShareFromMasterSecret,
} from "./slip39";
import { MasterSecret } from "./domain";
import { hexToBytes } from "@noble/hashes/utils.js";

const runIdentity = <E>(
  masterSecretLayer: Layer.Layer<MasterSecretProvider, E>,
) =>
  Effect.runPromise(
    Effect.provide(
      IdentityProvider,
      Layer.provideMerge(IdentityProvider.layer, masterSecretLayer),
    ),
  );

describe("SLIP-39", () => {
  it("encodes a master secret as the share Finito shows for it", async () => {
    // Finito's `masterKeyToMnemonic("00112233445566778899aabbccddeeff")`.
    const secret = MasterSecret.make(
      hexToBytes("00112233445566778899aabbccddeeff"),
    );
    const share = await Effect.runPromise(slip39ShareFromMasterSecret(secret));
    expect(share).toBe(
      "academic else academic academic canyon album laden hairy debris ladle beard agree glad twin always dance metric lily strike herd",
    );
    expect(
      await Effect.runPromise(recoverMasterSecretFromSlip39Share(share)),
    ).toEqual(secret);
  });

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

  it("rejects a recovered secret holding non-byte values", async () => {
    const share = await Effect.runPromise(createSlip39Share());
    const parsed = await Effect.runPromise(parseSlip39Share(share));
    const recoverSecret = vi
      .spyOn(Slip39, "recoverSecret")
      .mockResolvedValue([256, ...Array<number>(15).fill(0)]);
    try {
      await expect(
        Effect.runPromise(recoverMasterSecretFromSlip39Share(parsed)),
      ).rejects.toThrow("Recovered SLIP-39 secret has invalid byte shape");
    } finally {
      recoverSecret.mockRestore();
    }
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
    expect(await Effect.runPromise(fromNoisy.cashuWalletSeed)).toEqual(
      await Effect.runPromise(clean.cashuWalletSeed),
    );
  });
});
