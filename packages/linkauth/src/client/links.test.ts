import { describe, expect, it } from "vitest";
import { parseLinkauthLink } from "../signer/index.js";
import { AUDIENCE, CALLBACK, NONCE } from "../testing/fixtures.js";
import { linkauthLinks } from "./links.js";
import type { LinkauthLinksOptions } from "./links.js";

const links = (options: Partial<LinkauthLinksOptions> = {}) =>
  linkauthLinks({
    audience: AUDIENCE,
    nonce: NONCE,
    callbackUrl: CALLBACK,
    ...options,
  });

describe("linkauthLinks", () => {
  it("builds a same-device link with the callback and a QR link without", () => {
    const { openUrl, qrUrl } = links();
    expect(openUrl.startsWith("https://app.linky.fit/#linkauth?")).toBe(true);
    expect(parseLinkauthLink(openUrl)).toEqual({
      audience: AUDIENCE,
      nonce: NONCE,
      callback: CALLBACK,
    });
    expect(qrUrl.startsWith("https://app.linky.fit/#linkauth?")).toBe(true);
    expect(parseLinkauthLink(qrUrl)).toEqual({
      audience: AUDIENCE,
      nonce: NONCE,
      callback: null,
    });
    expect(qrUrl).not.toContain("cb=");
  });

  it("opens the nightly app on request", () => {
    const { openUrl, qrUrl } = links({ signerApp: "nightly" });
    expect(openUrl.startsWith("https://nightly.app.linky.fit/#")).toBe(true);
    expect(qrUrl.startsWith("https://nightly.app.linky.fit/#")).toBe(true);
  });

  it("lets signerAppUrl override signerApp", () => {
    const { openUrl, qrUrl } = links({
      signerApp: "nightly",
      signerAppUrl: "http://localhost:5173/",
    });
    expect(openUrl.startsWith("http://localhost:5173/#linkauth?")).toBe(true);
    expect(qrUrl.startsWith("http://localhost:5173/#linkauth?")).toBe(true);
  });

  it.each([
    [
      "a callback on another origin",
      { callbackUrl: "https://evil.example/cb" },
    ],
    [
      "a callback on another port",
      { callbackUrl: "https://shop.example:8443/cb" },
    ],
    [
      "an http audience",
      {
        audience: "http://shop.example",
        callbackUrl: "http://shop.example/cb",
      },
    ],
    ["a callback with a query", { callbackUrl: `${CALLBACK}?next=1` }],
    ["a callback with a fragment", { callbackUrl: `${CALLBACK}#x` }],
    ["a relative callback", { callbackUrl: "/login/done" }],
    ["a short nonce", { nonce: "abc" }],
  ])("throws for %s", (_name, override) => {
    expect(() => links(override)).toThrow(TypeError);
  });
});
