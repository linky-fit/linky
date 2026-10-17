import { describe, expect, it } from "bun:test";
import { encodeNpub } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { buildCashuToken } from "@linky-fit/linky-app/src/testUtils/cashuToken";
import { linkauthFragment } from "@linky-fit/linky-app/src/testUtils/siteLoginFixtures";
import { classifyIncomingUrl } from "./incomingUrl";

const memoryStore = () => {
  const values = new Map<string, string>();
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => void values.set(key, value),
  };
};

const classify = (url: string) => classifyIncomingUrl(url, memoryStore());

const token = buildCashuToken({ amounts: [16] });
const npub = encodeNpub(makeIdentity().pubkey);
const contactId = "a".repeat(64);
const nostrConnect =
  "nostrconnect://" + "b".repeat(64) + "?relay=wss%3A%2F%2Frelay.example";

describe("classifyIncomingUrl", () => {
  it.each([
    [`cashu:${token}`, `cashu:${token}`],
    [`cashu://${token}`, `cashu:${token}`],
    [`nostr:${npub}`, `nostr:${npub}`],
    [`nostr://${npub}`, `nostr:${npub}`],
    [nostrConnect, nostrConnect],
  ])("hands %s to the scanned-text handler", (url, text) => {
    expect(classify(url)).toEqual({ _tag: "ScanText", text });
  });

  it("ignores a Cashu link without a token", () => {
    expect(classify("cashu:not-a-token")).toBeNull();
  });

  it.each([
    `linky://#add/${npub}`,
    `linky:///#add/${npub}`,
    `linky://contacts#add/${npub}`,
    `https://app.linky.fit/#add/${npub}`,
    `https://app.linky.fit/#${linkauthFragment()}`,
    `https://app.linky.fit/#wallet?cashu=${token}`,
    `linky://#${nostrConnect}`,
  ])("leaves the command link in %s to its fragment reader", (url) => {
    const hash = url.slice(url.indexOf("#"));
    expect(classify(url)).toEqual({ _tag: "HashLink", hash });
  });

  it.each([
    [`linky://chat/${contactId}`, `/chat/${contactId}`],
    ["linky:///wallet/transactions", "/wallet/transactions"],
    ["linky://contacts", "/contacts"],
    ["https://app.linky.fit/settings", "/settings"],
    [`https://app.linky.fit/#chat/${contactId}`, `/chat/${contactId}`],
    [`linky://#chat/${contactId}`, `/chat/${contactId}`],
  ])("opens the route of %s", (url, href) => {
    expect(classify(url)).toEqual({ _tag: "Route", href });
  });

  it.each([
    "linky://",
    "linky:///",
    "https://app.linky.fit",
    "linky://no-such-route",
    "linky:///#no-such-link",
    "exp+linky://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081",
    "https://app.linky.fit.evil.example/#add/x",
    "https://linky.fit/settings",
    "mailto:someone@example.com",
  ])("ignores %s", (url) => {
    expect(classify(url)).toBeNull();
  });
});
