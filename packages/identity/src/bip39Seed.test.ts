import { bytesToHex } from "@noble/hashes/utils.js";
import { mnemonicToSeedSync } from "@scure/bip39";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { bip39MnemonicToSeed } from "./bip39Seed";

const seedHex = async (mnemonic: string, passphrase?: string) =>
  bytesToHex(
    await Effect.runPromise(bip39MnemonicToSeed(mnemonic, passphrase)),
  );

describe("bip39MnemonicToSeed", () => {
  it("matches the BIP-39 reference vector", async () => {
    expect(
      await seedHex(
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        "TREZOR",
      ),
    ).toBe(
      "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04",
    );
  });

  it("NFKD-normalizes the mnemonic and the passphrase", async () => {
    const mnemonic =
      "legal winner thank year wave sausage worth useful legal winner thank yellow";
    const composed = "café";
    expect(await seedHex(mnemonic, composed)).toBe(
      await seedHex(mnemonic, "café"),
    );
    expect(await seedHex(mnemonic, composed)).toBe(
      bytesToHex(mnemonicToSeedSync(mnemonic, composed)),
    );
  });

  it("rejects a mnemonic with a word count BIP-39 does not define", async () => {
    await expect(
      Effect.runPromise(bip39MnemonicToSeed("abandon abandon abandon")),
    ).rejects.toThrow("Failed to derive the BIP-39 seed");
  });
});
