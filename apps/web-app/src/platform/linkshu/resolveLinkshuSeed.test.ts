// @vitest-environment jsdom
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INITIAL_MNEMONIC_STORAGE_KEY } from "../../mnemonic";
import { CASHU_BIP85_MNEMONIC_STORAGE_KEY } from "../../utils/constants";
import { resolveLinkshuSeed } from "./resolveLinkshuSeed";

// The real write path goes through native secret storage; in the browser it
// lands in localStorage, which is all the resolver's read path looks at.
vi.mock("../identitySecrets", () => ({
  writeStoredCashuMnemonic: (mnemonic: string) => {
    localStorage.setItem(CASHU_BIP85_MNEMONIC_STORAGE_KEY, mnemonic);
    return Promise.resolve();
  },
}));

const CASHU_MNEMONIC =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";
const INITIAL_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

afterEach(() => {
  localStorage.clear();
});

describe("resolveLinkshuSeed", () => {
  it("prefers the stored cashu BIP-85 mnemonic", async () => {
    localStorage.setItem(CASHU_BIP85_MNEMONIC_STORAGE_KEY, CASHU_MNEMONIC);
    localStorage.setItem(INITIAL_MNEMONIC_STORAGE_KEY, INITIAL_MNEMONIC);

    const seed = await resolveLinkshuSeed();

    expect(seed).toEqual(mnemonicToSeedSync(CASHU_MNEMONIC));
  });

  it("falls back to the initial app mnemonic without persisting it as the cashu mnemonic", async () => {
    localStorage.setItem(INITIAL_MNEMONIC_STORAGE_KEY, INITIAL_MNEMONIC);

    const seed = await resolveLinkshuSeed();

    expect(seed).toEqual(mnemonicToSeedSync(INITIAL_MNEMONIC));
    expect(localStorage.getItem(CASHU_BIP85_MNEMONIC_STORAGE_KEY)).toBeNull();
  });

  it("does not fall back past an invalid stored cashu mnemonic (legacy behavior)", async () => {
    localStorage.setItem(CASHU_BIP85_MNEMONIC_STORAGE_KEY, "not a mnemonic");
    localStorage.setItem(INITIAL_MNEMONIC_STORAGE_KEY, INITIAL_MNEMONIC);

    const seed = await resolveLinkshuSeed();

    expect(seed).not.toEqual(mnemonicToSeedSync(INITIAL_MNEMONIC));
    const persisted = localStorage.getItem(CASHU_BIP85_MNEMONIC_STORAGE_KEY);
    expect(validateMnemonic(persisted ?? "", wordlist)).toBe(true);
  });

  it("generates and persists a fresh cashu mnemonic when neither yields a valid one", async () => {
    localStorage.setItem(CASHU_BIP85_MNEMONIC_STORAGE_KEY, "not a mnemonic");

    const seed = await resolveLinkshuSeed();

    const persisted = localStorage.getItem(CASHU_BIP85_MNEMONIC_STORAGE_KEY);
    expect(persisted).not.toBeNull();
    expect(validateMnemonic(persisted ?? "", wordlist)).toBe(true);
    expect(persisted?.split(" ")).toHaveLength(24);
    expect(seed).toEqual(mnemonicToSeedSync(persisted ?? ""));
  });
});
