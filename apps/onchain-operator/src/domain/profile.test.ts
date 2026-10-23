import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  feePercentText,
  parseAmounts,
  parseFeePercent,
  parseMinClientVersion,
  parseProfileForm,
  profileForm,
  onchainConfigOf,
} from "./profile";

const tpub =
  "tpubDDfvzhdVV4unsoKt5aE6dcsNsfeWbTgmLZPi8LQDYU2xixrYemMfWJ3BaVneH3u7DBQePdTwhpybaKRU95pi6PMUtLPBJLVQRpzEnjfjZzX";

describe("fee percent", () => {
  it("reads percent with a dot or a comma as basis points", () => {
    expect(parseFeePercent("1")).toBe(100);
    expect(parseFeePercent(" 0.5 ")).toBe(50);
    expect(parseFeePercent("0,25")).toBe(25);
    expect(parseFeePercent("100")).toBe(10_000);
    expect(parseFeePercent("0")).toBe(0);
  });

  it("rejects what is no whole basis point from 0 to 100 %", () => {
    for (const text of ["", "-1", "100.01", "0.125", "1e2", "abc"])
      expect(parseFeePercent(text)).toBeNull();
  });

  it("shows basis points as percent", () => {
    expect(feePercentText(100)).toBe("1");
    expect(feePercentText(25)).toBe("0.25");
    expect(parseFeePercent(feePercentText(1_234))).toBe(1_234);
  });
});

describe("parseAmounts", () => {
  it("reads sats separated by commas, sorted and without repeats", () => {
    expect(parseAmounts("250 000, 100000;100000\n1_000_000")).toEqual([
      100_000, 250_000, 1_000_000,
    ]);
  });

  it("rejects an empty list and anything but positive whole numbers", () => {
    for (const text of ["", " , ", "0", "1.5", "100k", "-5"])
      expect(parseAmounts(text)).toBeNull();
  });
});

describe("parseMinClientVersion", () => {
  it("reads a Linky version, and nothing as no minimum", () => {
    expect(parseMinClientVersion(" 26.10.7 ")).toBe("26.10.7");
    expect(parseMinClientVersion(" ")).toBeNull();
  });

  it("rejects what is no YY.M.MICRO version", () => {
    for (const text of [
      "26.10",
      "v26.10.7",
      "26.10.7-rc",
      "a.b.c",
      `${"9".repeat(17)}.1.1`,
    ])
      expect(parseMinClientVersion(text)).toBeUndefined();
  });
});

describe("parseProfileForm", () => {
  const form = { ...profileForm(null), xpub: tpub, description: " Hi " };

  it("turns a valid form into a profile", () => {
    expect(parseProfileForm(form, "regtest")).toEqual(
      Result.succeed({
        name: "Linky support",
        xpub: tpub,
        feeBasisPoints: 100,
        paused: false,
        description: "Hi",
        amounts: [100_000, 250_000, 500_000, 1_000_000],
        maxReceiveAmount: 1_000_000,
        minClientVersion: null,
        watchers: [],
      }),
    );
  });

  it("names every invalid field", () => {
    expect(
      parseProfileForm(
        {
          name: " ",
          xpub: tpub,
          feePercent: "x",
          paused: true,
          description: "a".repeat(1001),
          amounts: "",
          maxReceiveAmount: "0",
          minClientVersion: "26.10",
          watchers: "npub1nope",
        },
        "mainnet",
      ),
    ).toEqual(
      Result.fail({
        name: "invalid",
        xpub: "invalid",
        feePercent: "invalid",
        description: "invalid",
        amounts: "invalid",
        maxReceiveAmount: "invalid",
        minClientVersion: "invalid",
        watchers: "invalid",
      }),
    );
  });

  it("fills the form back from a saved profile", () => {
    const parsed = parseProfileForm(form, "regtest");
    if (Result.isFailure(parsed)) throw new Error("form did not parse");
    expect(profileForm(parsed.success)).toEqual({ ...form, description: "Hi" });
  });

  it("publishes the profile with the app's mint, network and explorer", () => {
    const parsed = parseProfileForm(form, "regtest");
    if (Result.isFailure(parsed)) throw new Error("form did not parse");
    const appConfig = {
      mintUrl: "https://cashu.cz",
      network: "regtest",
      explorerUrl: "http://localhost:3003",
    } as const;
    expect(
      onchainConfigOf(
        { ...parsed.success, minClientVersion: "26.10.7" },
        appConfig,
      ).minClientVersion,
    ).toBe("26.10.7");
    expect(onchainConfigOf(parsed.success, appConfig)).toEqual({
      v: 1,
      feeBasisPoints: 100,
      paused: false,
      description: "Hi",
      amounts: [100_000, 250_000, 500_000, 1_000_000],
      maxReceiveAmount: 1_000_000,
      mintUrl: "https://cashu.cz",
      network: "regtest",
      explorerUrl: "http://localhost:3003",
    });
  });
});
