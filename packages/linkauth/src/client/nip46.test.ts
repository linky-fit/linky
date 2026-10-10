import { getPublicKey } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyLinkauth } from "../server/index.js";
import { authTemplate } from "../template.js";
import { connectFakeSigner, FakeRelayPool } from "../testing/fakeRelay.js";
import type { SignerBehavior } from "../testing/fakeRelay.js";
import { AUDIENCE, NONCE, newKey } from "../testing/fixtures.js";
import { LinkauthError } from "./error.js";
import { connectNip46 } from "./nip46.js";
import type { Nip46LoginOptions } from "./nip46.js";

const RELAYS: Nip46LoginOptions["relays"] = [
  "wss://relay.one",
  "wss://relay.two",
];

const setup = (options: Partial<Nip46LoginOptions> = {}) => {
  const pool = new FakeRelayPool();
  const login = connectNip46({
    audience: AUDIENCE,
    nonce: NONCE,
    name: "Shop",
    relays: RELAYS,
    pool,
    ...options,
  });
  return { pool, login };
};

const pair = (
  pool: FakeRelayPool,
  uri: string,
  behavior: SignerBehavior,
  secret?: string,
) => {
  const userKey = newKey();
  const signer = connectFakeSigner(pool, uri, {
    userKey,
    signerKey: newKey(),
    behavior,
    ...(secret === undefined ? {} : { secret }),
  });
  return { userKey, signer };
};

const failure = async <T>(promise: Promise<T>): Promise<LinkauthError> => {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(LinkauthError);
  if (!(error instanceof LinkauthError)) throw new Error("unreachable");
  return error;
};

describe("connectNip46", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("pairs, signs and resolves with an assertion the server accepts", async () => {
    const { pool, login } = setup();
    const { userKey } = pair(pool, login.uri, { mode: "sign" });
    const assertion = await login.assertion;
    expect(
      verifyLinkauth(assertion, { audience: AUDIENCE, nonce: NONCE }),
    ).toEqual({
      ok: true,
      pubkey: getPublicKey(userKey),
      createdAt: assertion.created_at,
    });
    expect(pool.openSubscriptions).toBe(1);
  });

  it("asks for the canonical template under the sign_event permission", async () => {
    const { pool, login } = setup({ image: "https://shop.example/logo.png" });
    const { signer } = pair(pool, login.uri, { mode: "sign" });
    await login.assertion;
    expect(signer.signRequests).toBe(1);
    const link = new URL(login.uri);
    expect(link.protocol).toBe("nostrconnect:");
    expect(link.searchParams.getAll("relay")).toEqual(RELAYS);
    expect(link.searchParams.get("perms")).toBe("sign_event:24139");
    expect(link.searchParams.get("url")).toBe(AUDIENCE);
    expect(link.searchParams.get("name")).toBe("Shop");
    expect(link.searchParams.get("image")).toBe(
      "https://shop.example/logo.png",
    );
    expect(link.searchParams.get("secret")).toMatch(/^[0-9a-f]{32}$/);
  });

  it.each([
    [
      "another kind",
      (template: ReturnType<typeof authTemplate>) => ({
        ...template,
        kind: 27235,
      }),
    ],
    [
      "another nonce",
      () => authTemplate({ audience: AUDIENCE, nonce: "m".repeat(43) }),
    ],
    [
      "another audience",
      () => authTemplate({ audience: "https://evil.example", nonce: NONCE }),
    ],
    [
      "an extra tag",
      (template: ReturnType<typeof authTemplate>) => ({
        ...template,
        tags: [...template.tags, ["u", "https://shop.example/wallet"]],
      }),
    ],
  ])("rejects a signer that returns %s", async (_name, template) => {
    const { pool, login } = setup();
    pair(pool, login.uri, { mode: "sign", template });
    expect((await failure(login.assertion)).code).toBe("refused");
    expect(pool.openSubscriptions).toBe(1); // only the fake signer's own
  });

  it("surfaces a signer error as refused", async () => {
    const { pool, login } = setup();
    pair(pool, login.uri, { mode: "error", message: "user denied" });
    const error = await failure(login.assertion);
    expect(error.code).toBe("refused");
    expect(error.message).toBe("user denied");
  });

  it("ignores an ack that does not carry the secret", async () => {
    const { pool, login } = setup();
    const { signer } = pair(pool, login.uri, { mode: "sign" }, "f".repeat(32));
    const result = failure(login.assertion);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect((await result).code).toBe("timeout");
    expect(signer.signRequests).toBe(0);
  });

  it("fails at once when the signer declines the pairing", async () => {
    const { pool, login } = setup();
    pair(pool, login.uri, { mode: "decline", message: "user denied" });
    const error = await failure(login.assertion);
    expect(error.code).toBe("refused");
    expect(error.message).toBe("user denied");
  });

  it("times out waiting for a signer to connect", async () => {
    const { pool, login } = setup({ connectTimeoutMs: 1000 });
    const result = failure(login.assertion);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await result).code).toBe("timeout");
    expect(pool.openSubscriptions).toBe(0);
  });

  it("times out waiting for the signature", async () => {
    const { pool, login } = setup({ replyTimeoutMs: 2000 });
    pair(pool, login.uri, { mode: "silent" });
    const result = failure(login.assertion);
    await vi.advanceTimersByTimeAsync(2000);
    expect((await result).code).toBe("timeout");
  });

  it("cancels, closes the subscription and stays settled", async () => {
    const { pool, login } = setup();
    const result = failure(login.assertion);
    login.cancel();
    login.cancel();
    expect((await result).code).toBe("cancelled");
    expect(pool.openSubscriptions).toBe(0);
  });

  it("does not raise an unhandled rejection when nobody awaits a cancelled login", async () => {
    const { login } = setup();
    login.cancel();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("cancels on abort, also before the start", async () => {
    const controller = new AbortController();
    const { login } = setup({ signal: controller.signal });
    const result = failure(login.assertion);
    controller.abort();
    expect((await result).code).toBe("cancelled");

    const late = setup({ signal: AbortSignal.abort() });
    expect((await failure(late.login.assertion)).code).toBe("cancelled");
  });

  it("fails when every relay drops the subscription", async () => {
    const { pool, login } = setup();
    const result = failure(login.assertion);
    pool.disconnectAll();
    expect((await result).code).toBe("relays-unreachable");
  });

  it("fails when no relay takes the sign request", async () => {
    const { pool, login } = setup();
    pair(pool, login.uri, { mode: "sign" });
    pool.rejectPublish = true;
    const result = failure(login.assertion);
    // The ack is already queued; the sign request is what no relay accepts.
    expect((await result).code).toBe("relays-unreachable");
  });
});

describe("ready", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves once the relays are listening", async () => {
    const { pool, login } = setup();
    await expect(login.ready).resolves.toBeUndefined();
    expect(pool.openSubscriptions).toBe(1);
    login.cancel();
  });

  it("does not wait longer than 5 seconds for a relay that stays silent", async () => {
    const pool = new FakeRelayPool();
    pool.holdEose = true;
    const { login } = setup({ pool });
    let settled = false;
    void login.ready.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    login.cancel();
  });

  it("rejects with relays-unreachable when no relay opened", async () => {
    const pool = new FakeRelayPool();
    pool.relaysDown = true;
    const { login } = setup({ pool });
    expect((await failure(login.ready)).code).toBe("relays-unreachable");
    expect((await failure(login.assertion)).code).toBe("relays-unreachable");
  });

  it("rejects when the attempt ends first", async () => {
    const pool = new FakeRelayPool();
    pool.holdEose = true;
    const { login } = setup({ pool });
    login.cancel();
    expect((await failure(login.ready)).code).toBe("cancelled");
  });
});

describe("connectNip46 arguments", () => {
  it.each([
    ["an http audience", { audience: "http://shop.example" }],
    ["a short nonce", { nonce: "abc" }],
    ["a blank name", { name: " " }],
  ])("throws for %s", (_name, override) => {
    expect(() => setup(override)).toThrow(TypeError);
  });
});
