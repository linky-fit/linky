import { authTemplate } from "@linky-fit/linkauth";
import { createHash } from "node:crypto";
import { wrapAssertion } from "@linky-fit/linkauth/signer";
import type { Event } from "nostr-tools";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import { bytesToHex } from "nostr-tools/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import challenge from "./demo-auth/challenge.js";
import { createReceiveHandler } from "./demo-auth/receive.js";
import verify from "./demo-auth/verify.js";
import linkauthDocument from "./linkauth.js";
import recommendedRelays from "../public/recommended-relays.json" with { type: "json" };
import { signedNonce, type DemoAuthRequest } from "./_demoAuth.js";
import type { ApiResponse } from "./_npubcash.js";

const LOCAL = "localhost:5180";
const LOCAL_ORIGIN = `http://${LOCAL}`;

interface Sent {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

const run = async (
  handler: (req: DemoAuthRequest, res: ApiResponse) => unknown,
  req: DemoAuthRequest,
): Promise<Sent> => {
  const sent: Sent = { status: 0, body: {}, headers: {} };
  await handler(req, {
    setHeader: (name, value) => {
      sent.headers[name] = value;
    },
    status: (code) => {
      sent.status = code;
      return {
        json: (body) => {
          sent.body = body;
        },
        send: () => undefined,
      };
    },
  });
  return sent;
};

const receiverKey = generateSecretKey();

const issueChallenge = (host = LOCAL) =>
  run(challenge, { method: "GET", headers: { host } });

const cookieOf = (sent: Sent): string =>
  (sent.headers["Set-Cookie"] ?? "").split(";")[0] ?? "";

const key = generateSecretKey();
// structuredClone drops nostr-tools' cached `verified` marker, as JSON on the wire does.
const signedFor = (audience: string, nonce: string) =>
  structuredClone(
    finalizeEvent(
      {
        ...authTemplate({ audience, nonce }),
        created_at: Math.floor(Date.now() / 1000),
      },
      key,
    ),
  );

const submit = (assertion: unknown, cookie: string | null, host = LOCAL) =>
  run(verify, {
    method: "POST",
    headers: { host, ...(cookie === null ? {} : { cookie }) },
    body: { assertion },
  });

beforeEach(() => {
  vi.stubEnv("LINKY_DEMO_AUTH_SECRET_KEY", bytesToHex(receiverKey));
  vi.stubEnv("LINKY_DEMO_AUTH_RELAYS", undefined);
  vi.stubEnv("LINKY_DEMO_AUTH_AUDIENCE", undefined);
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("VERCEL_URL", undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("demo auth challenge", () => {
  it("returns a fresh nonce and stores it in a short-lived HttpOnly cookie", async () => {
    const first = await issueChallenge();
    const second = await issueChallenge();

    expect(first.status).toBe(200);
    expect(first.body.nonce).not.toBe(second.body.nonce);
    expect(first.headers["Set-Cookie"]).toBe(
      `linky_demo_auth_nonce=${signedNonce(receiverKey, String(first.body.nonce))}; Path=/api/demo-auth; Max-Age=300; HttpOnly; SameSite=Lax`,
    );
    expect(first.headers["Cache-Control"]).toBe("no-store");
  });

  it("marks the cookie Secure everywhere but on a loopback host", async () => {
    const production = await issueChallenge("linky.fit");

    expect(production.headers["Set-Cookie"]).toContain("; Secure");
  });

  it("does not let a Host header pick the audience", async () => {
    const sent = await issueChallenge("evil.example");

    expect(sent.headers["Set-Cookie"]).toContain("; Secure");
  });

  it("answers 503 without a receiving key", async () => {
    vi.stubEnv("LINKY_DEMO_AUTH_SECRET_KEY", undefined);

    const sent = await issueChallenge();

    expect(sent.status).toBe(503);
    expect(sent.headers["Set-Cookie"]).toBeUndefined();
  });

  it("only answers GET", async () => {
    const sent = await run(challenge, {
      method: "POST",
      headers: { host: LOCAL },
    });

    expect(sent.status).toBe(405);
    expect(sent.headers["Set-Cookie"]).toBeUndefined();
  });
});

describe("demo auth verify", () => {
  it("accepts an assertion for this origin and clears the cookie", async () => {
    const issued = await issueChallenge();
    const assertion = signedFor(LOCAL_ORIGIN, String(issued.body.nonce));

    const sent = await submit(assertion, cookieOf(issued));

    expect(sent.status).toBe(200);
    expect(sent.body.pubkey).toMatch(/^[0-9a-f]{64}$/u);
    expect(sent.headers["Set-Cookie"]).toContain("Max-Age=0");
  });

  it("rejects the same assertion once the cookie is cleared", async () => {
    const issued = await issueChallenge();
    const assertion = signedFor(LOCAL_ORIGIN, String(issued.body.nonce));
    expect((await submit(assertion, cookieOf(issued))).status).toBe(200);

    expect((await submit(assertion, null)).status).toBe(401);
  });

  it("rejects a request without the nonce cookie and leaves any cookie alone", async () => {
    const sent = await submit(signedFor(LOCAL_ORIGIN, "n".repeat(43)), null);

    expect(sent.status).toBe(401);
    expect(sent.headers["Set-Cookie"]).toBeUndefined();
  });

  it.each([
    ["malformed", "linky_demo_auth_nonce=short"],
    ["unsigned", `linky_demo_auth_nonce=${"n".repeat(43)}`],
    [
      "signed with another key",
      `linky_demo_auth_nonce=${signedNonce(generateSecretKey(), "n".repeat(43))}`,
    ],
    [
      "signed for another nonce",
      `linky_demo_auth_nonce=${"m".repeat(43)}.${signedNonce(receiverKey, "n".repeat(43)).split(".")[1]}`,
    ],
  ])("rejects a %s nonce cookie", async (_name, cookie) => {
    const sent = await submit(signedFor(LOCAL_ORIGIN, "n".repeat(43)), cookie);

    expect(sent.status).toBe(401);
    expect(sent.headers["Set-Cookie"]).toBeUndefined();
  });

  it("answers 503 without a receiving key", async () => {
    const issued = await issueChallenge();
    vi.stubEnv("LINKY_DEMO_AUTH_SECRET_KEY", undefined);

    const sent = await submit(
      signedFor(LOCAL_ORIGIN, String(issued.body.nonce)),
      cookieOf(issued),
    );

    expect(sent.status).toBe(503);
  });

  it("rejects an assertion for another origin", async () => {
    const issued = await issueChallenge();
    const assertion = signedFor(
      "https://other.example",
      String(issued.body.nonce),
    );

    expect((await submit(assertion, cookieOf(issued))).status).toBe(401);
    expect(console.warn).toHaveBeenCalledWith(
      "demo login rejected",
      "wrong-audience",
    );
  });

  it("rejects an assertion for a nonce this visitor was not issued", async () => {
    const issued = await issueChallenge();
    const assertion = signedFor(LOCAL_ORIGIN, "x".repeat(43));

    expect((await submit(assertion, cookieOf(issued))).status).toBe(401);
  });

  it("rejects a NIP-98 HTTP auth event", async () => {
    const issued = await issueChallenge();
    const foreign = structuredClone(
      finalizeEvent(
        {
          kind: 27235,
          tags: [
            ["u", `${LOCAL_ORIGIN}/api/demo-auth/verify`],
            ["method", "POST"],
            ["nonce", String(issued.body.nonce)],
          ],
          content: "",
          created_at: Math.floor(Date.now() / 1000),
        },
        key,
      ),
    );

    expect((await submit(foreign, cookieOf(issued))).status).toBe(401);
    expect(console.warn).toHaveBeenCalledWith(
      "demo login rejected",
      "wrong-kind",
    );
  });

  it("rejects an assertion for the Host header's origin on a public host", async () => {
    const issued = await issueChallenge("evil.example");
    const assertion = signedFor(
      "https://evil.example",
      String(issued.body.nonce),
    );

    expect(
      (await submit(assertion, cookieOf(issued), "evil.example")).status,
    ).toBe(401);
  });

  it("uses LINKY_DEMO_AUTH_AUDIENCE when set", async () => {
    vi.stubEnv("LINKY_DEMO_AUTH_AUDIENCE", "https://preview.example");
    const issued = await issueChallenge("preview.example");
    const assertion = signedFor(
      "https://preview.example",
      String(issued.body.nonce),
    );

    expect(
      (await submit(assertion, cookieOf(issued), "preview.example")).status,
    ).toBe(200);
  });

  it("binds to the Vercel preview host on a preview deployment only", async () => {
    const host = "linky-site-git-demo.vercel.app";
    const loginAt = async () => {
      const issued = await issueChallenge(host);
      const sent = await submit(
        signedFor(`https://${host}`, String(issued.body.nonce)),
        cookieOf(issued),
        host,
      );
      return sent.status;
    };
    vi.stubEnv("VERCEL_URL", host);
    expect(await loginAt()).toBe(401);

    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await loginAt()).toBe(200);
  });

  it("only answers POST", async () => {
    const sent = await run(verify, { method: "GET", headers: { host: LOCAL } });

    expect(sent.status).toBe(405);
  });
});

describe("demo auth domain document", () => {
  const fetchDocument = (host = LOCAL) =>
    run(linkauthDocument, { method: "GET", headers: { host } });

  it("publishes the receiving key, relays and the exact callback", async () => {
    vi.stubEnv("LINKY_DEMO_AUTH_RELAYS", "ws://localhost:7777, ");

    const sent = await fetchDocument();

    expect(sent.status).toBe(200);
    expect(sent.body).toEqual({
      version: 1,
      name: "Linky auth demo",
      icon: `${LOCAL_ORIGIN}/icon.svg`,
      pubkey: getPublicKey(receiverKey),
      relays: ["ws://localhost:7777"],
      callbacks: [`${LOCAL_ORIGIN}/demo/auth/`],
    });
    expect(sent.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(sent.headers["Cache-Control"]).toBe("public, max-age=60");
  });

  it("defaults to the recommended relays and the audience's callback", async () => {
    vi.stubEnv("LINKY_DEMO_AUTH_AUDIENCE", "https://preview.example");

    const sent = await fetchDocument("preview.example");

    expect(sent.body.relays).toEqual(recommendedRelays.nostr);
    expect(sent.body.callbacks).toEqual(["https://preview.example/demo/auth/"]);
    expect(sent.body.icon).toBe("https://preview.example/icon.svg");
  });

  it("keeps at most five relays and only those the document accepts", async () => {
    vi.stubEnv(
      "LINKY_DEMO_AUTH_RELAYS",
      "https://web.example,ws://insecure.example,wss://a.example,wss://user:pw@b.example,wss://c.example,wss://d.example,wss://e.example,wss://f.example,wss://g.example",
    );

    vi.stubEnv("LINKY_DEMO_AUTH_AUDIENCE", "https://preview.example");

    const sent = await fetchDocument("preview.example");

    expect(sent.status).toBe(200);
    expect(sent.body.relays).toEqual([
      "wss://a.example",
      "wss://c.example",
      "wss://d.example",
      "wss://e.example",
      "wss://f.example",
    ]);
  });

  it("answers 503 when no configured relay is acceptable", async () => {
    vi.stubEnv("LINKY_DEMO_AUTH_RELAYS", "http://nostr.example");

    const sent = await fetchDocument();

    expect(sent.status).toBe(503);
    expect(sent.body.error).toContain("LINKY_DEMO_AUTH_RELAYS");
  });

  it("answers 503 without a receiving key, or with a malformed one", async () => {
    vi.stubEnv("LINKY_DEMO_AUTH_SECRET_KEY", undefined);
    expect((await fetchDocument()).status).toBe(503);

    vi.stubEnv("LINKY_DEMO_AUTH_SECRET_KEY", "not-hex");
    expect((await fetchDocument()).status).toBe(503);
  });

  it("only answers GET", async () => {
    const sent = await run(linkauthDocument, {
      method: "POST",
      headers: { host: LOCAL },
    });

    expect(sent.status).toBe(405);
  });
});

describe("demo auth receive", () => {
  const delivered: Event[] = [];
  const pool = { querySync: () => Promise.resolve(delivered) };
  const receive = (cookie: string | null, host = LOCAL) =>
    run(createReceiveHandler(pool), {
      method: "POST",
      headers: { host, ...(cookie === null ? {} : { cookie }) },
    });

  const deliver = (audience: string, nonce: string) => {
    delivered.push(
      wrapAssertion(signedFor(audience, nonce), getPublicKey(receiverKey)),
    );
  };

  beforeEach(() => {
    delivered.length = 0;
  });

  it("answers pending and keeps the cookie until the login arrives", async () => {
    const issued = await issueChallenge();

    const sent = await receive(cookieOf(issued));

    expect(sent.status).toBe(202);
    expect(sent.body).toEqual({ status: "pending" });
    expect(sent.headers["Set-Cookie"]).toBeUndefined();
  });

  it("verifies a delivered login and clears the cookie", async () => {
    const issued = await issueChallenge();
    deliver(LOCAL_ORIGIN, String(issued.body.nonce));

    const sent = await receive(cookieOf(issued));

    expect(sent.status).toBe(200);
    expect(sent.body.pubkey).toBe(getPublicKey(key));
    expect(sent.headers["Set-Cookie"]).toContain("Max-Age=0");
  });

  it("ignores a login for another nonce", async () => {
    const issued = await issueChallenge();
    deliver(LOCAL_ORIGIN, "x".repeat(43));

    expect((await receive(cookieOf(issued))).status).toBe(202);
  });

  it("ignores a login for another origin", async () => {
    const issued = await issueChallenge();
    deliver("https://other.example", String(issued.body.nonce));

    expect((await receive(cookieOf(issued))).status).toBe(202);
  });

  it("rejects an expired login", async () => {
    const issued = await issueChallenge();
    const stale = structuredClone(
      finalizeEvent(
        {
          ...authTemplate({
            audience: LOCAL_ORIGIN,
            nonce: String(issued.body.nonce),
          }),
          created_at: Math.floor(Date.now() / 1000) - 3600,
        },
        key,
      ),
    );
    delivered.push(wrapAssertion(stale, getPublicKey(receiverKey)));

    const sent = await receive(cookieOf(issued));

    expect(sent.status).toBe(401);
    expect(console.warn).toHaveBeenCalledWith("demo login rejected", "expired");
  });

  it("rejects a request without a valid nonce cookie before asking any relay", async () => {
    const querySync = vi.fn(() => Promise.resolve([]));
    const forged = `linky_demo_auth_nonce=${"n".repeat(43)}`;

    for (const cookie of [null, forged]) {
      const sent = await run(createReceiveHandler({ querySync }), {
        method: "POST",
        headers: { host: LOCAL, ...(cookie === null ? {} : { cookie }) },
      });
      expect(sent.status).toBe(401);
      expect(sent.headers["Set-Cookie"]).toBeUndefined();
    }
    expect(querySync).not.toHaveBeenCalled();
  });

  it("queries the configured relays", async () => {
    vi.stubEnv("LINKY_DEMO_AUTH_RELAYS", "ws://localhost:7777");
    const querySync = vi.fn(() => Promise.resolve([]));
    const issued = await issueChallenge();

    await run(createReceiveHandler({ querySync }), {
      method: "POST",
      headers: { host: LOCAL, cookie: cookieOf(issued) },
    });

    expect(querySync).toHaveBeenCalledWith(
      ["ws://localhost:7777"],
      expect.objectContaining({
        "#p": [getPublicKey(receiverKey)],
        "#x": [
          createHash("sha256").update(String(issued.body.nonce)).digest("hex"),
        ],
      }),
      { maxWait: 3000 },
    );
  });

  it("answers 503 without a receiving key", async () => {
    const issued = await issueChallenge();
    vi.stubEnv("LINKY_DEMO_AUTH_SECRET_KEY", undefined);

    expect((await receive(cookieOf(issued))).status).toBe(503);
  });

  it("only answers POST", async () => {
    const sent = await run(createReceiveHandler(pool), {
      method: "GET",
      headers: { host: LOCAL },
    });

    expect(sent.status).toBe(405);
  });
});
