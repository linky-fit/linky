import { MintUrl, WalletBalances } from "@linky-fit/linkshu";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { fundedMints, parseLightningTarget, parseSats } from "./wallet";

// A FakeWallet invoice of a local dev mint for 2 084 sat.
const invoice =
  "lnbc20840n1p4vf3079qypqqqdq6fdshdsapwfhxzgz4ypxv8tts0yxqrrsssp5p9n75rrkt7v9slzhqwmewr5pqjktywd064ge2wpn4jqwm3rr6tzspp5res2cd0mu7y3cg24dmrj90u28mxzll0vexp38elkdvggd53ulrusuhnauhksa5w3rz8ng9p37wr7x8z9v44v2rquk86z48qxuutzfljr3gzx8uxqka2sc2fyymm7jmeu7gent8yadv0nvqmzcmk0phurxtqpwmex3a";

describe("parseLightningTarget", () => {
  it("reads an invoice with its amount, also behind a scheme or in a BIP-321 URI", () => {
    for (const text of [
      invoice,
      ` lightning:${invoice.toUpperCase()} `,
      `bitcoin:?lightning=${invoice}`,
    ]) {
      expect(parseLightningTarget(text)).toMatchObject({
        kind: "invoice",
        invoice,
        amountSats: 2_084,
        expiresAtSec: expect.any(Number),
      });
    }
  });

  it("reads a Lightning address and an LNURL", () => {
    expect(parseLightningTarget("lightning:alice@example.com")).toEqual({
      kind: "address",
      target: "alice@example.com",
    });
    const lnurl =
      "LNURL1DP68GURN8GHJ7UM9WFMXJCM99E3K7MF0V9CXJ0M385EKVCENXC6R2C35XVUKXEFCV5MKVV34X5EKZD3EV56NYD3HXQURZEPEXEJXXEPNXSCRVWFNV9NXZCN9XQ6XYEFHVGCXXCMYXYMNSERXFQ5FNS";
    expect(parseLightningTarget(lnurl)?.kind).toBe("address");
  });

  it.each([
    "",
    "hello",
    "lnbc1broken",
    invoice.slice(0, -1),
    "bitcoin:bc1qxyz?amount=0.1",
    "npub1j3ntgmxzkw4rrxeh5ksrkca4tq994exjxxz2xr8dwp6xzgtjqq3s490wfg",
  ])("refuses %s", (text) => {
    expect(parseLightningTarget(text)).toBeNull();
  });
});

describe("parseSats", () => {
  it.each([
    ["21", 21],
    [" 1 000 ", 1_000],
    ["10_000", 10_000],
  ])("reads %s", (text, sats) => {
    expect(parseSats(text)).toBe(sats);
  });

  it.each(["", "0", "-5", "1.5", "07", "abc", "9".repeat(20)])(
    "refuses %s",
    (text) => {
      expect(parseSats(text)).toBeNull();
    },
  );
});

describe("fundedMints", () => {
  const balances = (perMint: Record<string, number>) =>
    Schema.decodeUnknownSync(WalletBalances)({
      total: 0,
      spendable: 0,
      perMint: Object.entries(perMint).map(([mint, amount]) => ({
        mint,
        amount,
      })),
    });

  it("puts the transfer mint first, then the largest balance, and drops empty mints", () => {
    expect(
      fundedMints(
        balances({
          "https://a.test": 50,
          "https://transfer.test": 10,
          "https://b.test": 200,
          "https://empty.test": 0,
        }),
        "https://transfer.test/",
      ),
    ).toEqual([
      { mint: MintUrl.make("https://transfer.test"), sats: 10 },
      { mint: MintUrl.make("https://b.test"), sats: 200 },
      { mint: MintUrl.make("https://a.test"), sats: 50 },
    ]);
  });

  it("is empty before the balance is read", () => {
    expect(fundedMints(null, "https://transfer.test")).toEqual([]);
  });
});
