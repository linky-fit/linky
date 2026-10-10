import { getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { fetchDomainDocument } from "./fetchDomain.js";
import type { LinkauthFetch } from "./fetchDomain.js";
import {
  AUDIENCE,
  documentFor,
  fakeFetch,
  newKey,
  serving,
} from "./testing/fixtures.js";

const pubkey = getPublicKey(newKey());

describe("fetchDomainDocument", () => {
  it("loads the well-known file without credentials, redirects or referrer", async () => {
    const { fetch, requests } = serving(documentFor(pubkey));
    const result = await fetchDomainDocument(`${AUDIENCE}/some/page`, {
      fetch,
    });
    expect(result).toMatchObject({
      ok: true,
      domain: { name: "Shop", pubkey },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(`${AUDIENCE}/.well-known/linkauth.json`);
    expect(requests[0]?.init).toMatchObject({
      method: "GET",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(requests[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("refuses an origin that is not an acceptable site without fetching", async () => {
    const { fetch, requests } = serving(documentFor(pubkey));
    for (const origin of [
      "http://shop.example",
      "javascript:alert(1)",
      "https://a:b@shop.example",
      "nope",
    ]) {
      expect(await fetchDomainDocument(origin, { fetch })).toEqual({
        ok: false,
        reason: "invalid-origin",
      });
    }
    expect(requests).toHaveLength(0);
  });

  it("is unreachable when fetch throws (a redirect does) or the status is not 2xx", async () => {
    const redirecting: LinkauthFetch = (_url, init) =>
      Promise.reject(
        init.redirect === "error"
          ? new TypeError("redirect")
          : new Error("followed"),
      );
    expect(await fetchDomainDocument(AUDIENCE, { fetch: redirecting })).toEqual(
      { ok: false, reason: "unreachable" },
    );
    const missing = fakeFetch(() => new Response("{}", { status: 404 }));
    expect(
      await fetchDomainDocument(AUDIENCE, { fetch: missing.fetch }),
    ).toEqual({ ok: false, reason: "unreachable" });
  });

  it("is unreachable when the request outlives the timeout", async () => {
    const hanging: LinkauthFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    expect(
      await fetchDomainDocument(AUDIENCE, { fetch: hanging, timeoutMs: 10 }),
    ).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });

  it("refuses a body over 4096 bytes, declared or streamed", async () => {
    const big = JSON.stringify(documentFor(pubkey, { name: "x".repeat(5000) }));
    const streamed = fakeFetch(big);
    expect(
      await fetchDomainDocument(AUDIENCE, { fetch: streamed.fetch }),
    ).toEqual({ ok: false, reason: "too-large" });
    const declared = fakeFetch(
      () => new Response("{}", { headers: { "content-length": "99999" } }),
    );
    expect(
      await fetchDomainDocument(AUDIENCE, { fetch: declared.fetch }),
    ).toEqual({ ok: false, reason: "too-large" });
  });

  it("accepts a body of exactly 4096 bytes", async () => {
    const padded = JSON.stringify(documentFor(pubkey));
    const body = padded + " ".repeat(4096 - padded.length);
    expect(body).toHaveLength(4096);
    const { fetch } = fakeFetch(body);
    expect(await fetchDomainDocument(AUDIENCE, { fetch })).toMatchObject({
      ok: true,
    });
  });

  it.each([
    ["not JSON", "<html>"],
    ["empty", ""],
  ])("reports invalid-json for %s", async (_name, body) => {
    const { fetch } = fakeFetch(body);
    expect(await fetchDomainDocument(AUDIENCE, { fetch })).toEqual({
      ok: false,
      reason: "invalid-json",
    });
  });

  it("reports invalid-json for bytes that are not UTF-8", async () => {
    const { fetch } = fakeFetch(
      () => new Response(new Uint8Array([0xff, 0xfe, 0x7b])),
    );
    expect(await fetchDomainDocument(AUDIENCE, { fetch })).toEqual({
      ok: false,
      reason: "invalid-json",
    });
  });

  it.each([
    [
      "a cross-origin icon",
      { icon: "https://cdn.example/i.png" },
      "invalid-document:bad-icon",
    ],
    [
      "a cross-origin callback",
      { callbacks: ["https://evil.example/cb"] },
      "invalid-document:bad-callbacks",
    ],
    ["a wrong version", { version: 2 }, "invalid-document:bad-version"],
  ])("reports %s as an invalid document", async (_name, overrides, reason) => {
    const { fetch } = serving(documentFor(pubkey, overrides));
    expect(await fetchDomainDocument(AUDIENCE, { fetch })).toEqual({
      ok: false,
      reason,
    });
  });

  it("reports a JSON value that is not an object", async () => {
    const { fetch } = fakeFetch("[1]");
    expect(await fetchDomainDocument(AUDIENCE, { fetch })).toEqual({
      ok: false,
      reason: "invalid-document:not-an-object",
    });
  });
});
