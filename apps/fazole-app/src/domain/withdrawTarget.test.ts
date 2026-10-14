import { encodeNprofile, encodeNpub } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { describe, expect, it } from "vitest";
import { parsePubkeyInput, parseWithdrawTarget } from "./withdrawTarget";

const { pubkey } = makeIdentity();
const npub = encodeNpub(pubkey);
// A FakeWallet invoice of a local dev mint for 2 084 sat.
const invoice =
  "lnbc20840n1p4vf3079qypqqqdq6fdshdsapwfhxzgz4ypxv8tts0yxqrrsssp5p9n75rrkt7v9slzhqwmewr5pqjktywd064ge2wpn4jqwm3rr6tzspp5res2cd0mu7y3cg24dmrj90u28mxzll0vexp38elkdvggd53ulrusuhnauhksa5w3rz8ng9p37wr7x8z9v44v2rquk86z48qxuutzfljr3gzx8uxqka2sc2fyymm7jmeu7gent8yadv0nvqmzcmk0phurxtqpwmex3a";

describe("parsePubkeyInput", () => {
  it.each([
    npub,
    ` ${npub} `,
    `nostr:${npub}`,
    pubkey,
    encodeNprofile(pubkey, ["wss://relay.test"]),
    `nostr:${encodeNprofile(pubkey, [])}`,
    `https://linky.fit/p/${npub}`,
    `https://linky.fit/p/${npub.replace(/^n/u, "%6e")}`,
    `https://app.linky.fit/p/${npub}?ref=qr`,
    `linky.fit/p/${npub}`,
  ])("reads %s", (text) => {
    expect(parsePubkeyInput(text)).toBe(pubkey);
  });

  it("refuses a Linky link with a name and other text", () => {
    expect(parsePubkeyInput("https://linky.fit/p/alice")).toBeNull();
    expect(parseWithdrawTarget("https://linky.fit/p/alice")).toBeNull();
    expect(parsePubkeyInput("hello")).toBeNull();
  });

  it.each(["%", "%GG", "%E0%A4%A"])(
    "refuses a Linky link with malformed encoding %s",
    (path) => {
      const text = `https://linky.fit/p/${path}`;
      expect(parsePubkeyInput(text)).toBeNull();
      expect(parseWithdrawTarget(text)).toBeNull();
    },
  );
});

describe("parseWithdrawTarget", () => {
  it("sends to a Linky user as a chat token", () => {
    expect(parseWithdrawTarget(`https://linky.fit/p/${npub}`)).toEqual({
      kind: "cashu_chat",
      pubkey,
      npub,
    });
  });

  it("reads an invoice with its amount, also behind a scheme or in a BIP-321 URI", () => {
    for (const text of [
      invoice,
      ` lightning:${invoice.toUpperCase()} `,
      `bitcoin:?lightning=${invoice}&creq=creqAxyz`,
    ]) {
      expect(parseWithdrawTarget(text)).toEqual({
        kind: "lightning_invoice",
        invoice,
        amountSats: 2_084,
      });
    }
  });

  it("reads a Lightning address, an LNURL and a BIP-321 address leg", () => {
    expect(parseWithdrawTarget("alice@example.com")).toEqual({
      kind: "lightning_address",
      target: "alice@example.com",
    });
    expect(parseWithdrawTarget("lightning:alice@example.com")).toEqual({
      kind: "lightning_address",
      target: "alice@example.com",
    });
    expect(
      parseWithdrawTarget("bitcoin:alice@example.com?amount=0.0001"),
    ).toEqual({ kind: "lightning_address", target: "alice@example.com" });
    const lnurl =
      "LNURL1DP68GURN8GHJ7UM9WFMXJCM99E3K7MF0V9CXJ0M385EKVCENXC6R2C35XVUKXEFCV5MKVV34X5EKZD3EV56NYD3HXQURZEPEXEJXXEPNXSCRVWFNV9NXZCN9XQ6XYEFHVGCXXCMYXYMNSERXFQ5FNS";
    expect(parseWithdrawTarget(lnurl)?.kind).toBe("lightning_address");
  });

  it("refuses an on-chain URI, a broken invoice and plain text", () => {
    expect(parseWithdrawTarget("bitcoin:bc1qxyz?amount=0.1")).toBeNull();
    expect(parseWithdrawTarget("lnbc1broken")).toBeNull();
    expect(parseWithdrawTarget("")).toBeNull();
    expect(parseWithdrawTarget("hello")).toBeNull();
  });
});
