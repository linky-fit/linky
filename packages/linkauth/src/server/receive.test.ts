import type { Event } from "nostr-tools";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { authTemplate } from "../template.js";
import { FakeQueryPool } from "../testing/fakeQueryPool.js";
import {
  AUDIENCE,
  NONCE,
  newKey,
  signLogin,
  wrapAt,
} from "../testing/fixtures.js";
import { LINKAUTH_WRAP_KIND, nonceHash } from "../wrap.js";
import { receiveLinkauth } from "./receive.js";

const NOW = 1_800_000_000;
const RELAYS = ["wss://relay.shop.example"];
const domainKey = newKey();
const domainPubkey = getPublicKey(domainKey);
const userKey = newKey();

const deliver = (
  pool: FakeQueryPool,
  options: { nonce?: string; at?: number; to?: string; key?: Uint8Array } = {},
) => {
  const assertion = signLogin(options.key ?? userKey, {
    template: authTemplate({
      audience: AUDIENCE,
      nonce: options.nonce ?? NONCE,
    }),
    createdAt: options.at ?? NOW,
  });
  const dated = wrapAt(
    assertion,
    options.to ?? domainPubkey,
    options.at ?? NOW,
  );
  pool.events.push(dated);
  return assertion;
};

const receive = (
  pool: FakeQueryPool,
  overrides: Partial<Parameters<typeof receiveLinkauth>[0]> = {},
) =>
  receiveLinkauth({
    secretKey: domainKey,
    relays: RELAYS,
    audience: AUDIENCE,
    nonce: NONCE,
    now: NOW,
    pool,
    ...overrides,
  });

describe("receiveLinkauth", () => {
  it("returns the verified login for a delivered assertion", async () => {
    const pool = new FakeQueryPool();
    deliver(pool);
    expect(await receive(pool)).toEqual({
      ok: true,
      pubkey: getPublicKey(userKey),
      createdAt: NOW,
    });
  });

  it("queries recent kind 1059 events tagged with the site's key and the nonce hash, once", async () => {
    const pool = new FakeQueryPool();
    await receive(pool, { maxAgeSeconds: 120 });
    expect(pool.queries).toHaveLength(1);
    expect(pool.queries[0]?.relays).toEqual(RELAYS);
    expect(pool.queries[0]?.filter).toMatchObject({
      kinds: [LINKAUTH_WRAP_KIND],
      "#p": [domainPubkey],
      "#x": [nonceHash(NONCE)],
      since: NOW - 120,
      until: NOW + 60,
    });
  });

  it("is not blocked by a flood of other wraps to the site's key", async () => {
    const pool = new FakeQueryPool();
    // The fake relay never checks signatures, so unsigned filler keeps the flood cheap.
    const garbage = (tags: string[][], at: number): Event => ({
      id: "0".repeat(64),
      pubkey: "1".repeat(64),
      sig: "2".repeat(128),
      kind: LINKAUTH_WRAP_KIND,
      created_at: at,
      tags,
      content: "garbage",
    });
    for (let i = 0; i < 150; i += 1) {
      pool.events.push(
        garbage([["p", domainPubkey]], NOW + 30),
        garbage(
          [
            ["p", domainPubkey],
            ["x", nonceHash(`flood${i}`.padEnd(22, "0"))],
          ],
          NOW + 30,
        ),
      );
    }
    deliver(pool);
    expect(await receive(pool)).toMatchObject({ ok: true });
  });

  it("does not see a wrap dated beyond the future bound", async () => {
    const pool = new FakeQueryPool();
    deliver(pool, { at: NOW + 61 });
    expect(await receive(pool)).toEqual({ ok: false, reason: "not-delivered" });
  });

  it("ignores a wrap whose x tag is not the hash of its own nonce", async () => {
    const pool = new FakeQueryPool();
    const otherLogin = signLogin(newKey(), {
      template: authTemplate({ audience: AUDIENCE, nonce: "m".repeat(43) }),
      createdAt: NOW,
    });
    pool.events.push(
      wrapAt(otherLogin, domainPubkey, NOW, [
        ["p", domainPubkey],
        ["x", nonceHash(NONCE)],
      ]),
    );
    expect(await receive(pool)).toEqual({ ok: false, reason: "not-delivered" });
  });

  it("reports not-delivered when nothing arrived", async () => {
    expect(await receive(new FakeQueryPool())).toEqual({
      ok: false,
      reason: "not-delivered",
    });
  });

  it("ignores a delivery for another nonce", async () => {
    const pool = new FakeQueryPool();
    deliver(pool, { nonce: "m".repeat(43) });
    expect(await receive(pool)).toEqual({ ok: false, reason: "not-delivered" });
  });

  it("finds the matching delivery among others", async () => {
    const pool = new FakeQueryPool();
    deliver(pool, { nonce: "m".repeat(43), key: newKey() });
    deliver(pool, { nonce: "k".repeat(43), key: newKey() });
    deliver(pool);
    expect(await receive(pool)).toMatchObject({
      ok: true,
      pubkey: getPublicKey(userKey),
    });
  });

  it("ignores garbage: undecryptable, wrong kind and other keys' deliveries", async () => {
    const pool = new FakeQueryPool();
    const other = newKey();
    pool.events.push(
      finalizeEvent(
        {
          kind: LINKAUTH_WRAP_KIND,
          created_at: NOW,
          tags: [["p", domainPubkey]],
          content: "garbage",
        },
        other,
      ),
      finalizeEvent(
        {
          kind: 1,
          created_at: NOW,
          tags: [["p", domainPubkey]],
          content: "hi",
        },
        other,
      ),
    );
    deliver(pool, { to: getPublicKey(newKey()) });
    expect(await receive(pool)).toEqual({ ok: false, reason: "not-delivered" });
  });

  it("does not accept a delivery encrypted to another site's key", async () => {
    const pool = new FakeQueryPool();
    const otherSite = newKey();
    deliver(pool);
    expect(await receive(pool, { secretKey: otherSite })).toEqual({
      ok: false,
      reason: "not-delivered",
    });
  });

  it("reports expired for an assertion older than the window that still reached the relay", async () => {
    const pool = new FakeQueryPool();
    const assertion = signLogin(userKey, { createdAt: NOW - 1000 });
    pool.events.push(wrapAt(assertion, domainPubkey, NOW));
    expect(await receive(pool)).toEqual({ ok: false, reason: "expired" });
  });

  it("does not see a delivery older than the window", async () => {
    const pool = new FakeQueryPool();
    deliver(pool, { at: NOW - 1000 });
    expect(await receive(pool)).toEqual({ ok: false, reason: "not-delivered" });
  });

  it("prefers a valid login over an expired one with the same nonce", async () => {
    const pool = new FakeQueryPool();
    const stale = signLogin(newKey(), { createdAt: NOW - 1000 });
    pool.events.push(wrapAt(stale, domainPubkey, NOW));
    deliver(pool);
    expect(await receive(pool)).toMatchObject({ ok: true });
  });

  it("throws for an invalid audience or nonce, even with nothing delivered", async () => {
    const pool = new FakeQueryPool();
    await expect(
      receive(pool, { audience: "http://shop.example" }),
    ).rejects.toThrow(TypeError);
    await expect(receive(pool, { nonce: "short" })).rejects.toThrow(TypeError);
  });
});
