import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signedInSession } from "../../testUtils/appRegistry";
import type { SessionSecrets, SignedInSession } from "../session";
import { resolveLinkshuSeed } from "./resolveLinkshuSeed";

const stored = vi.hoisted(
  (): { cashuMnemonic: string | null; writes: number } => ({
    cashuMnemonic: null,
    writes: 0,
  }),
);
vi.mock("../identitySecrets", () => ({
  readStoredCashuMnemonic: () => Promise.resolve(stored.cashuMnemonic),
  writeStoredCashuMnemonic: (mnemonic: string) => {
    stored.cashuMnemonic = mnemonic;
    stored.writes += 1;
    return Promise.resolve();
  },
}));

const CASHU_MNEMONIC =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";
const APP_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/** Booted on the localStorage copies, with `unreadable` failing in the secure store and having no copy. */
const degraded = (
  secrets: Partial<SessionSecrets>,
  unreadable: ReadonlyArray<keyof SessionSecrets>,
): SignedInSession => ({
  ...signedInSession(secrets),
  degraded: true,
  cause: "bridge down",
  unreadable: new Set(unreadable),
});

afterEach(() => {
  stored.cashuMnemonic = null;
  stored.writes = 0;
});

describe("resolveLinkshuSeed", () => {
  it("prefers the session's cashu BIP-85 mnemonic", async () => {
    const seed = await resolveLinkshuSeed(
      signedInSession({
        cashuMnemonic: CASHU_MNEMONIC,
        appMnemonic: APP_MNEMONIC,
      }),
    );

    expect(seed).toEqual(mnemonicToSeedSync(CASHU_MNEMONIC));
  });

  it("falls back to the app mnemonic without persisting it as the cashu mnemonic", async () => {
    const seed = await resolveLinkshuSeed(
      signedInSession({ cashuMnemonic: null, appMnemonic: APP_MNEMONIC }),
    );

    expect(seed).toEqual(mnemonicToSeedSync(APP_MNEMONIC));
    expect(stored.writes).toBe(0);
  });

  it("does not fall back past an invalid cashu mnemonic (legacy behavior)", async () => {
    stored.cashuMnemonic = "not a mnemonic";
    const seed = await resolveLinkshuSeed(
      signedInSession({
        cashuMnemonic: "not a mnemonic",
        appMnemonic: APP_MNEMONIC,
      }),
    );

    expect(seed).not.toEqual(mnemonicToSeedSync(APP_MNEMONIC));
    expect(validateMnemonic(stored.cashuMnemonic, wordlist)).toBe(true);
  });

  it("generates and persists a fresh 24-word cashu mnemonic when neither yields a valid one", async () => {
    const seed = await resolveLinkshuSeed(
      signedInSession({ cashuMnemonic: null, appMnemonic: null }),
    );

    const persisted = stored.cashuMnemonic ?? "";
    expect(validateMnemonic(persisted, wordlist)).toBe(true);
    expect(persisted.split(" ")).toHaveLength(24);
    expect(seed).toEqual(mnemonicToSeedSync(persisted));
  });

  it("reuses a cashu mnemonic saved after the session was read instead of generating another", async () => {
    stored.cashuMnemonic = CASHU_MNEMONIC;

    const seed = await resolveLinkshuSeed(
      signedInSession({ cashuMnemonic: null, appMnemonic: null }),
    );

    expect(seed).toEqual(mnemonicToSeedSync(CASHU_MNEMONIC));
    expect(stored.writes).toBe(0);
  });

  describe("on a degraded session", () => {
    it("leaves the wallet unconfigured instead of generating over an unreadable cashu mnemonic", async () => {
      const seed = await resolveLinkshuSeed(
        degraded({ cashuMnemonic: null, appMnemonic: APP_MNEMONIC }, [
          "cashuMnemonic",
        ]),
      );

      expect(seed).toBeNull();
      expect(stored.writes).toBe(0);
    });

    it("does not generate a cashu mnemonic when the app mnemonic it would fall back to is unreadable", async () => {
      const seed = await resolveLinkshuSeed(
        degraded({ cashuMnemonic: null, appMnemonic: null }, ["appMnemonic"]),
      );

      expect(seed).toBeNull();
      expect(stored.writes).toBe(0);
    });

    it("resolves normally when only an unrelated secret is unreadable", async () => {
      const seed = await resolveLinkshuSeed(
        degraded({ cashuMnemonic: null, appMnemonic: null }, ["slip39Seed"]),
      );

      expect(seed).toEqual(mnemonicToSeedSync(stored.cashuMnemonic ?? ""));
      expect(stored.writes).toBe(1);
    });

    it("uses a readable cashu mnemonic even when the app mnemonic is unreadable", async () => {
      const seed = await resolveLinkshuSeed(
        degraded({ cashuMnemonic: CASHU_MNEMONIC, appMnemonic: null }, [
          "appMnemonic",
        ]),
      );

      expect(seed).toEqual(mnemonicToSeedSync(CASHU_MNEMONIC));
    });
  });
});
