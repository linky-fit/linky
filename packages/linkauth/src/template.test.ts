import { describe, expect, it } from "vitest";
import { normalizeAudience } from "./audience.js";
import { createNonce, isNonce } from "./nonce.js";
import {
  authTemplate,
  isCanonicalAuthTemplate,
  LINKAUTH_KIND,
  readAuthTemplate,
} from "./template.js";
import { AUDIENCE, NONCE } from "./testing/fixtures.js";

describe("authTemplate", () => {
  it("is exactly the protocol shape", () => {
    expect(authTemplate({ audience: AUDIENCE, nonce: NONCE })).toEqual({
      kind: 24139,
      tags: [
        ["linky", "auth"],
        ["audience", AUDIENCE],
        ["nonce", NONCE],
      ],
      content: `Log in to ${AUDIENCE}`,
    });
    expect(LINKAUTH_KIND).toBe(24139);
  });

  it("is read back, and only when canonical", () => {
    const template = authTemplate({ audience: AUDIENCE, nonce: NONCE });
    expect(readAuthTemplate(template)).toEqual({
      audience: AUDIENCE,
      nonce: NONCE,
    });
    expect(readAuthTemplate({ ...template, content: "Log in" })).toBeNull();
    expect(
      readAuthTemplate({ ...template, tags: [...template.tags, ["x", "y"]] }),
    ).toBeNull();
    expect(
      readAuthTemplate({ ...template, tags: [...template.tags].reverse() }),
    ).toBeNull();
    expect(readAuthTemplate({ ...template, kind: 27235 })).toBeNull();
    expect(
      readAuthTemplate(
        authTemplate({ audience: "https://shop.example/path", nonce: NONCE }),
      ),
    ).toBeNull();
    expect(
      readAuthTemplate(authTemplate({ audience: AUDIENCE, nonce: "short" })),
    ).toBeNull();
  });

  it("isCanonicalAuthTemplate binds the audience", () => {
    const template = authTemplate({ audience: AUDIENCE, nonce: NONCE });
    expect(isCanonicalAuthTemplate(template, AUDIENCE)).toBe(true);
    expect(isCanonicalAuthTemplate(template, `${AUDIENCE}/login`)).toBe(true);
    expect(isCanonicalAuthTemplate(template, "https://evil.example")).toBe(
      false,
    );
    expect(isCanonicalAuthTemplate(template, "ftp://shop.example")).toBe(false);
  });
});

describe("normalizeAudience", () => {
  it.each([
    ["https://shop.example", "https://shop.example"],
    ["https://shop.example/a/b?q=1#h", "https://shop.example"],
    ["HTTPS://Shop.Example:8443/", "https://shop.example:8443"],
    ["http://localhost:5173/cb", "http://localhost:5173"],
    ["http://127.0.0.1:3000", "http://127.0.0.1:3000"],
    ["http://[::1]:3000/x", "http://[::1]:3000"],
  ])("accepts %s", (input, origin) => {
    expect(normalizeAudience(input)).toBe(origin);
  });

  it.each([
    "http://shop.example",
    "http://localhost.evil.example",
    "https://user:pw@shop.example",
    "javascript:alert(1)",
    "nostrconnect://abc",
    "shop.example",
    "",
  ])("rejects %s", (input) => {
    expect(normalizeAudience(input)).toBeNull();
  });
});

describe("createNonce", () => {
  it("is URL-safe, at least 16 bytes and fresh", () => {
    const nonce = createNonce();
    expect(isNonce(nonce)).toBe(true);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(nonce).not.toBe(createNonce());
  });

  it("isNonce rejects short or unsafe strings", () => {
    expect(isNonce("a".repeat(21))).toBe(false);
    expect(isNonce("a".repeat(22))).toBe(true);
    expect(isNonce(`${"a".repeat(30)}+/`)).toBe(false);
    expect(isNonce("a".repeat(129))).toBe(false);
  });
});
