import { encodeNsec } from "@linky-fit/linkstr";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { memoryKv } from "../services/testing/fakes";
import {
  createRecoverySeed,
  deriveAccount,
  loadStoredAccount,
  looksLikeRecoverySeed,
  storeAccount,
} from "./account";

// The cross-app vector of @linky-fit/identity: Linky derives these from this share.
const linkyShare =
  "item lilac academic academic armed dress review premium imply typical dominant daisy voting random agency bike dive being coastal rocky";

describe("deriveAccount", () => {
  it("derives the identity, Evolu owner and cashu seed Linky derives", async () => {
    const account = await Effect.runPromise(deriveAccount(linkyShare));
    expect(account.npub).toBe(
      "npub1emlla45qgkxa0n6yj243m0uygv6332atrxckg7z5c4226lg3ke2qxdfpgk",
    );
    expect(encodeNsec(account.secretKey)).toBe(
      "nsec13lzw09lv9pd6zqtfxykleu8ny8hh0ux37r7qedcghz82m7mmwqjsaj430k",
    );
    expect(account.appMnemonic).toBe(
      "diet swift world sand heart donate squeeze never inner glove ability exist",
    );
    expect(bytesToHex(account.cashuSeed)).toBe(
      "650b25127a8e53204e5da804137f545a0cb1fa4497e5833b67768817b6aa50e6d34c28db7a47f79ba0582e3c009535a247f3cc953b37850683738197a1710f29",
    );
  });

  it("accepts the seed with other spacing and case", async () => {
    const account = await Effect.runPromise(
      deriveAccount(`  ${linkyShare.toUpperCase().replaceAll(" ", "\n")} `),
    );
    expect(account.recoverySeed).toBe(linkyShare);
  });

  it("refuses text that is not a recovery seed", async () => {
    const derived = await Effect.runPromise(
      Effect.result(deriveAccount("item lilac academic")),
    );
    expect(Result.isFailure(derived) && derived.failure._tag).toBe(
      "InvalidRecoverySeed",
    );
  });

  it("creates a 20-word seed that derives an account", async () => {
    const seed = await Effect.runPromise(createRecoverySeed);
    expect(looksLikeRecoverySeed(seed)).toBe(true);
    const account = await Effect.runPromise(deriveAccount(seed));
    expect(account.npub).toMatch(/^npub1/u);
  });
});

describe("the stored account", () => {
  it("round-trips through device storage", async () => {
    const kv = memoryKv();
    expect(loadStoredAccount(kv)).toBeNull();
    const account = await Effect.runPromise(deriveAccount(linkyShare));
    storeAccount(kv, account);
    expect(loadStoredAccount(kv)).toEqual(account);
  });

  it("reads unreadable storage as no account", () => {
    const kv = memoryKv();
    kv.setItem("linky.fazole.account", "{broken");
    expect(loadStoredAccount(kv)).toBeNull();
  });
});
