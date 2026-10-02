import {
  boltCardId,
  encodeCardMessage,
  type BoltCard,
  type BridgeMessage,
  type CardMessage,
} from "@linky-fit/bolt-card";
import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config";
import { createHttpHandler } from "./http";
import { InMemoryRateLimiter } from "./requestSecurity";
import { CardSessions } from "./sessions";
import {
  authMessage,
  FakeSocket,
  newCard,
  sessionOptions,
} from "./testSupport";

const baseEnv = {
  BOLT_CARD_BRIDGE_PUBLIC_URL: "https://bridge.example/",
  BOLT_CARD_BRIDGE_REQUEST_TIMEOUT_MS: "50",
  BOLT_CARD_BRIDGE_RATE_LIMIT_CARD_MAX: "3",
};

interface RequestOptions {
  method?: string;
  peerIp?: string;
  forwardedFor?: string;
}

const setup = (env: Record<string, string> = {}) => {
  const config = loadConfig({ ...baseEnv, ...env });
  const sessions = new CardSessions(sessionOptions());
  const handle = createHttpHandler({
    config,
    sessions,
    rateLimiter: new InMemoryRateLimiter(),
  });
  const request = async (path: string, options: RequestOptions = {}) => {
    const response = await handle(
      new Request(`http://bridge${path}`, {
        method: options.method ?? "GET",
        headers: options.forwardedFor
          ? { "x-forwarded-for": options.forwardedFor }
          : {},
      }),
      { peerIp: options.peerIp ?? "203.0.113.1", upgrade: () => false },
    );
    if (!response) throw new Error("expected a response");
    return response;
  };
  const get = async (path: string, options: RequestOptions = {}) => {
    const response = await request(path, options);
    return { status: response.status, body: await response.json() };
  };
  const connect = (
    card: BoltCard,
    reply: (message: BridgeMessage) => CardMessage | null,
  ) => {
    const socket = new FakeSocket();
    socket.onSend = (message) => {
      const answer = reply(message);
      if (answer) sessions.message(socket, encodeCardMessage(answer));
    };
    sessions.open(socket);
    sessions.message(socket, authMessage(card, socket.challenge));
    return socket;
  };
  return { connect, get, request, sessions };
};

const sun = "p=" + "AB".repeat(16) + "&c=" + "CD".repeat(8);
const k1 = "11".repeat(32);

describe("LNURL-withdraw endpoints", () => {
  test("relay a tap and its invoice to the card", async () => {
    const { connect, get } = setup();
    const card = newCard();
    const id = boltCardId(card);
    const seen: BridgeMessage[] = [];
    connect(card, (message) => {
      if (message._tag === "withdraw") {
        seen.push(message);
        return {
          _tag: "offer",
          id: message.id,
          k1,
          minWithdrawable: 1_000,
          maxWithdrawable: 50_000,
          defaultDescription: "Linky",
        };
      }
      if (message._tag === "callback") {
        seen.push(message);
        return { _tag: "accepted", id: message.id };
      }
      return null;
    });

    const withdraw = await get(`/w/${id}?${sun}`);
    expect(withdraw).toEqual({
      status: 200,
      body: {
        tag: "withdrawRequest",
        callback: `https://bridge.example/cb/${id}`,
        k1,
        minWithdrawable: 1_000,
        maxWithdrawable: 50_000,
        defaultDescription: "Linky",
      },
    });
    expect(seen[0]).toMatchObject({ _tag: "withdraw", p: "AB".repeat(16) });

    const callback = await get(`/cb/${id}?k1=${k1}&pr=lnbc1test`);
    expect(callback).toEqual({ status: 200, body: { status: "OK" } });
    expect(seen[1]).toMatchObject({ _tag: "callback", k1, pr: "lnbc1test" });
  });

  test("pass the card's rejection to the POS", async () => {
    const { connect, get } = setup();
    const card = newCard();
    connect(card, (message) =>
      message._tag === "challenge" || message._tag === "ready"
        ? null
        : { _tag: "rejected", id: message.id, reason: "Tap again" },
    );
    expect((await get(`/w/${boltCardId(card)}?${sun}`)).body).toEqual({
      status: "ERROR",
      reason: "Tap again",
    });
  });

  test("report an inactive card when no session answers", async () => {
    const { connect, get } = setup();
    const card = newCard();
    expect((await get(`/w/${boltCardId(card)}?${sun}`)).body).toEqual({
      status: "ERROR",
      reason: "Card is not active",
    });
    connect(card, () => null);
    expect(
      (await get(`/cb/${boltCardId(card)}?k1=${k1}&pr=lnbc1`)).body,
    ).toEqual({ status: "ERROR", reason: "Card is not active" });
  });

  test("refuse malformed requests before reaching the card", async () => {
    const { get } = setup();
    const id = boltCardId(newCard());
    expect((await get(`/w/not-a-card?${sun}`)).status).toBe(404);
    expect((await get(`/w/${id}?p=00&c=00`)).body).toEqual({
      status: "ERROR",
      reason: "Invalid card data",
    });
    expect((await get(`/cb/${id}?k1=00&pr=lnbc1`)).body).toEqual({
      status: "ERROR",
      reason: "Invalid callback",
    });
  });

  test("rate-limit one card", async () => {
    const { get } = setup();
    const id = boltCardId(newCard());
    for (let i = 0; i < 3; i += 1) await get(`/w/${id}?${sun}`);
    expect((await get(`/w/${id}?${sun}`)).status).toBe(429);
  });

  test("refuse a plain request to the session endpoint", async () => {
    const { get } = setup();
    expect((await get("/session")).status).toBe(426);
  });

  test("never turns an answer of the wrong kind into success", async () => {
    const { connect, get } = setup();
    const card = newCard();
    const id = boltCardId(card);
    // A confused or hostile card answers each request with the other kind.
    connect(card, (message) => {
      if (message._tag === "withdraw") {
        return { _tag: "accepted", id: message.id };
      }
      if (message._tag === "callback") {
        return {
          _tag: "offer",
          id: message.id,
          k1,
          minWithdrawable: 1_000,
          maxWithdrawable: 2_000,
          defaultDescription: "Linky",
        };
      }
      return null;
    });
    const withdraw = await get(`/w/${id}?${sun}`);
    expect(withdraw.body).toEqual({
      status: "ERROR",
      reason: "Card is not active",
    });
    const callback = await get(`/cb/${id}?k1=${k1}&pr=lnbc1`);
    expect(callback.body).toEqual({
      status: "ERROR",
      reason: "Card is not active",
    });
  });

  test("keeps concurrent taps of one card apart", async () => {
    const { connect, get, sessions } = setup({
      BOLT_CARD_BRIDGE_REQUEST_TIMEOUT_MS: "1000",
    });
    const card = newCard();
    const id = boltCardId(card);
    const held: { id: string; p: string }[] = [];
    const socket = connect(card, (message) => {
      if (message._tag === "withdraw") held.push(message);
      return null;
    });
    const first = get(`/w/${id}?p=${"01".repeat(16)}&c=${"00".repeat(8)}`);
    const second = get(`/w/${id}?p=${"02".repeat(16)}&c=${"00".repeat(8)}`);
    await Bun.sleep(0);
    expect(held).toHaveLength(2);
    // Answer in reverse order; each offer carries a limit derived from its p.
    for (const message of [...held].reverse()) {
      sessions.message(
        socket,
        encodeCardMessage({
          _tag: "offer",
          id: message.id,
          k1,
          minWithdrawable: 1_000,
          maxWithdrawable: Number.parseInt(message.p.slice(0, 2), 16) * 1_000,
          defaultDescription: "Linky",
        }),
      );
    }
    expect((await first).body).toMatchObject({ maxWithdrawable: 1_000 });
    expect((await second).body).toMatchObject({ maxWithdrawable: 2_000 });
  });

  test("builds the callback from a public URL with a base path", async () => {
    const { connect, get } = setup({
      BOLT_CARD_BRIDGE_PUBLIC_URL: "https://pay.example/bolt-card//",
    });
    const card = newCard();
    connect(card, (message) =>
      message._tag === "withdraw"
        ? {
            _tag: "offer",
            id: message.id,
            k1,
            minWithdrawable: 1_000,
            maxWithdrawable: 1_000,
            defaultDescription: "Linky",
          }
        : null,
    );
    const { body } = await get(`/w/${boltCardId(card)}?${sun.toLowerCase()}`);
    expect(body).toMatchObject({
      callback: `https://pay.example/bolt-card/cb/${boltCardId(card)}`,
    });
  });

  test("rate-limits by the client behind a trusted proxy, not the proxy", async () => {
    const { get } = setup({
      BOLT_CARD_BRIDGE_RATE_LIMIT_IP_MAX: "2",
      BOLT_CARD_BRIDGE_TRUSTED_PROXY_IPS: "10.0.0.1",
    });
    const viaProxy = (client: string) =>
      get("/w/unknown", { peerIp: "10.0.0.1", forwardedFor: client });
    expect((await viaProxy("198.51.100.1")).status).toBe(404);
    expect((await viaProxy("198.51.100.1")).status).toBe(404);
    expect((await viaProxy("198.51.100.1")).status).toBe(429);
    // Another client behind the same proxy has its own bucket.
    expect((await viaProxy("198.51.100.2")).status).toBe(404);

    // An untrusted peer cannot pick its bucket with a forged header.
    const forged = (client: string) =>
      get("/w/unknown", { peerIp: "203.0.113.9", forwardedFor: client });
    expect((await forged("198.51.100.3")).status).toBe(404);
    expect((await forged("198.51.100.4")).status).toBe(404);
    expect((await forged("198.51.100.5")).status).toBe(429);
  });

  test("answers LNURL requests to any origin and never lets them be cached", async () => {
    const { request } = setup();
    const preflight = await request("/w/x", { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");

    const response = await request(`/w/${boltCardId(newCard())}?${sun}`);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await request("/w/x", { method: "POST" })).status).toBe(405);
  });

  test("reports health and the build commit without touching rate limits", async () => {
    const { get } = setup({ BOLT_CARD_BRIDGE_RATE_LIMIT_IP_MAX: "1" });
    for (let i = 0; i < 3; i += 1) {
      expect(await get("/health")).toEqual({ status: 200, body: { ok: true } });
    }
    expect((await get("/")).body).toEqual({ ok: true, commit: "unknown" });
  });
});
