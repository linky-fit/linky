// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSlip39Share } from "@linky/identity";
import { Effect } from "effect";
import { generateSecretKey, nip19 } from "nostr-tools";
import {
  clearSavedSession,
  loginWithSecret,
  rememberSessionSeed,
  restoreSavedSession,
  SESSION_SEED_KEY,
} from "./auth";

const makeSeed = () => Effect.runPromise(createSlip39Share());

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("recovery seed login", () => {
  it("restores the same Nostr identity and Evolu owner after saving the seed", async () => {
    const seed = await makeSeed();
    const session = await loginWithSecret(seed);
    expect(localStorage.getItem(SESSION_SEED_KEY)).toBeNull();
    rememberSessionSeed(`  ${seed.toUpperCase().replaceAll(" ", "  ")}  `);
    const restored = await restoreSavedSession();
    expect(restored?.pubkey).toBe(session.pubkey);
    expect(restored?.ownerMnemonic).toBe(session.ownerMnemonic);
    session.dispose();
    restored?.dispose();
    clearSavedSession();
    expect(await restoreSavedSession()).toBeNull();
  });

  it("uses a different Evolu owner for a different recovery seed", async () => {
    const first = await loginWithSecret(await makeSeed());
    const second = await loginWithSecret(await makeSeed());
    expect(first.ownerMnemonic).not.toBe(second.ownerMnemonic);
    first.dispose();
    second.dispose();
  });

  it.each(["broken JSON", JSON.stringify("synthetic-private-input"), "42"])(
    "ignores and removes malformed saved login %s",
    async (raw) => {
      localStorage.setItem(SESSION_SEED_KEY, raw);
      expect(await restoreSavedSession()).toBeNull();
      expect(localStorage.getItem(SESSION_SEED_KEY)).toBeNull();
    },
  );

  it("rejects nsec-only login because it cannot recover the Evolu owner", async () => {
    await expect(
      loginWithSecret(nip19.nsecEncode(generateSecretKey())),
    ).rejects.toThrow("Enter a valid Linky 20-word recovery phrase.");
  });

  it("reports unavailable storage without exposing the phrase", async () => {
    const seed = await makeSeed();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("synthetic-private-input", "QuotaExceededError");
    });
    expect(() => rememberSessionSeed(seed)).toThrow(
      "Could not save your login. Enable browser storage and try again.",
    );
    expect(localStorage.getItem(SESSION_SEED_KEY)).toBeNull();
  });

  it("reports failure to remove a saved login", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("synthetic-private-input", "SecurityError");
    });
    expect(clearSavedSession).toThrow(
      "Could not remove your saved login. Enable browser storage and try again.",
    );
  });
});
