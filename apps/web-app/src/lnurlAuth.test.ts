// @vitest-environment jsdom
import {
  deriveLnurlAuthPublicKeyHex,
  signLnurlAuthChallenge,
} from "@linky-fit/identity";
import { identityFromNsec } from "@linky-fit/linkstr";
import { hexToBytes } from "@noble/hashes/utils.js";
import { nip19 } from "nostr-tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseLnurlAuthTarget, submitLnurlAuth } from "./lnurlAuth";

// Target parsing and the callback contract are linkshu's; what belongs here is
// that the app signs with the key the active nsec derives for that domain.

const K1 = "a".repeat(64);
const NSEC = nip19.nsecEncode(new Uint8Array(32).fill(3));
const AUTH_URL = `https://example.com/lnurl-auth?tag=login&k1=${K1}&action=login`;

describe("LNURL-auth signing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("signs the challenge with the domain's linking key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "OK" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const preview = parseLnurlAuthTarget(AUTH_URL);
    if (!preview) throw new Error("expected a login target");
    await submitLnurlAuth({ nsec: NSEC, preview });

    const identity = identityFromNsec(NSEC);
    if (!identity) throw new Error("expected a valid nsec");
    // The callback goes through the CORS proxy, so the signed URL is its
    // `url` parameter.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const proxied = new URL(
      String(fetchSpy.mock.calls[0]?.[0]),
      "http://localhost",
    );
    expect(proxied.pathname).toBe("/api/lnurlp");
    const called = new URL(proxied.searchParams.get("url") ?? "");
    expect(called.origin + called.pathname).toBe(
      "https://example.com/lnurl-auth",
    );
    expect(called.searchParams.get("key")).toBe(
      deriveLnurlAuthPublicKeyHex(identity.secretKey, "example.com"),
    );
    expect(called.searchParams.get("sig")).toBe(
      signLnurlAuthChallenge({
        challenge: hexToBytes(K1),
        domain: "example.com",
        nostrSecretKey: identity.secretKey,
      }).signatureHex,
    );
  });

  it("refuses to sign without an unlocked identity", async () => {
    const preview = parseLnurlAuthTarget(AUTH_URL);
    if (!preview) throw new Error("expected a login target");
    await expect(
      submitLnurlAuth({ nsec: "not-an-nsec", preview }),
    ).rejects.toThrow();
  });
});
