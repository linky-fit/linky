import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  derivePubkey,
  makePushOwnershipProof,
  NostrSecretKey,
  UnixSeconds,
} from "@linky/linkstr";

import { loadConfig } from "./config";
import { createHttpHandler } from "./http";
import { OwnershipVerifier } from "./ownership";
import { InMemoryRateLimiter } from "./rateLimit";
import { clientIp, MAX_REQUEST_BODY_BYTES } from "./requestSecurity";
import { PushStorage } from "./storage";

const secretKey = NostrSecretKey.make(new Uint8Array(32).fill(1));
const pubkey = derivePubkey(secretKey);
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
});

function serve(extraEnv: Record<string, string> = {}) {
  const config = loadConfig({
    PUSH_VAPID_SUBJECT: "mailto:test@example.com",
    PUSH_VAPID_PUBLIC_KEY: "unused",
    PUSH_VAPID_PRIVATE_KEY: "unused",
    ...extraEnv,
  });
  const storage = new PushStorage(":memory:");
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: createHttpHandler({
      config,
      storage,
      ownershipVerifier: new OwnershipVerifier({
        proofMaxAgeSeconds: 300,
        loadChallenge: (nonce) => storage.getChallenge(nonce),
      }),
      rateLimiter: new InMemoryRateLimiter(),
      pushDelivery: { nativeDeliveryEnabled: false },
    }),
  });
  cleanup.push(() => {
    server.stop(true);
    storage.close();
  });
  return { server, storage };
}

function post(
  server: Bun.Server<undefined>,
  path: string,
  body: unknown,
  forwarded = "",
) {
  return fetch(new URL(path, server.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": forwarded,
    },
    body: JSON.stringify(body),
  });
}

describe("push HTTP boundaries", () => {
  it("rate-limits the socket peer despite changing forged forwarding headers", async () => {
    const { server } = serve({ PUSH_RATE_LIMIT_AUTH_MAX: "1" });
    expect(
      (await post(server, "/auth/challenge", { pubkey }, "1.1.1.1")).status,
    ).toBe(200);
    expect(
      (await post(server, "/auth/challenge", { pubkey }, "8.8.8.8")).status,
    ).toBe(429);
  });

  it("trusts only the rightmost untrusted hop behind an explicitly trusted proxy", async () => {
    const { server } = serve({
      PUSH_RATE_LIMIT_AUTH_MAX: "1",
      PUSH_TRUSTED_PROXY_IPS: "127.0.0.1",
    });
    expect(
      (await post(server, "/auth/challenge", { pubkey }, "1.1.1.1, 8.8.8.8"))
        .status,
    ).toBe(200);
    expect(
      (await post(server, "/auth/challenge", { pubkey }, "9.9.9.9, 8.8.8.8"))
        .status,
    ).toBe(429);
    expect(
      (await post(server, "/auth/challenge", { pubkey }, "1.1.1.1")).status,
    ).toBe(200);
    expect(
      clientIp("127.0.0.1", "invalid, 127.0.0.2", ["127.0.0.1", "127.0.0.2"]),
    ).toBe("127.0.0.1");
  });

  it("rejects oversized JSON with and without content-length", async () => {
    const { server } = serve();
    const body = JSON.stringify({
      pubkey,
      padding: "x".repeat(MAX_REQUEST_BODY_BYTES),
    });
    expect(
      (
        await fetch(new URL("/auth/challenge", server.url), {
          method: "POST",
          body,
        })
      ).status,
    ).toBe(413);
    const chunks = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body.slice(0, 1000)));
        controller.enqueue(new TextEncoder().encode(body.slice(1000)));
        controller.close();
      },
    });
    expect(
      (
        await fetch(new URL("/auth/challenge", server.url), {
          method: "POST",
          body: chunks,
        })
      ).status,
    ).toBe(413);
  });

  it("does not log the identity or client IP when issuing a challenge", async () => {
    const { server } = serve();
    const log = spyOn(console, "info").mockImplementation(() => {});
    try {
      expect((await post(server, "/auth/challenge", { pubkey })).status).toBe(
        200,
      );
      expect(log.mock.calls).toEqual([
        ["[push] challenge issued action=subscribe"],
      ]);
    } finally {
      log.mockRestore();
    }
  });

  it("rejects unsafe endpoints and still accepts a signed browser subscription", async () => {
    const { server, storage } = serve();
    const nonce = storage.createChallenge(
      pubkey,
      "subscribe",
      Date.now() + 60_000,
      Date.now(),
    );
    const event = makePushOwnershipProof(
      { action: "subscribe", challenge: nonce },
      secretKey,
      UnixSeconds.make(Math.floor(Date.now() / 1000)),
    );
    const body = {
      recipientPubkeys: [pubkey],
      proofs: [{ pubkey, event }],
      subscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/test",
        keys: { p256dh: "key", auth: "auth" },
      },
    };
    for (const endpoint of [
      "http://fcm.googleapis.com/test",
      "https://127.0.0.1/test",
      "https://[::1]/test",
      "https://user:pass@fcm.googleapis.com/test",
      "https://fcm.googleapis.com:8443/test",
      "https://metadata.internal/test",
    ]) {
      expect(
        (
          await post(server, "/subscribe", {
            ...body,
            subscription: { ...body.subscription, endpoint },
          })
        ).status,
      ).toBe(400);
    }
    expect(storage.getSubscriptionsForPubkeys([pubkey]).size).toBe(0);
    expect((await post(server, "/subscribe", body)).status).toBe(200);
    expect(
      storage.getSubscriptionsForPubkeys([pubkey]).get(pubkey)?.[0]?.endpoint,
    ).toBe(body.subscription.endpoint);
  });
});
