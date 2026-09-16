import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendPushDebugLog, readPushDebugLog } from "./pushDebugLog";

const PUSH_LOG_URL = "/__debug__/push-log.json";
const HEX_PUBKEY =
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const OTHER_HEX_PUBKEY =
  "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2";
const NPUB = "npub180cvv07tqw7jwr9wnh4hp24w3wl74x64l0n6ms4qxp2vj8qz9c8sv96q8j";
const WRAP_ID =
  "9c1e5f0a6b3d4c2e8f7a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e";

let entries: Map<string, string>;

beforeEach(() => {
  entries = new Map();
  const cache = {
    match: (url: string) =>
      Promise.resolve(
        entries.has(url) ? new Response(entries.get(url)) : undefined,
      ),
    put: (url: string, res: Response) =>
      res.text().then((text) => {
        entries.set(url, text);
      }),
  };
  vi.stubGlobal("caches", { open: () => Promise.resolve(cache) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("appendPushDebugLog", () => {
  it("keeps identity keys out of the stored log", async () => {
    appendPushDebugLog("sw", "sw decrypt succeeded", {
      data: {
        outerEventId: WRAP_ID,
        recipientNpub: NPUB,
        recipientPubkey: HEX_PUBKEY,
        relayHints: ["wss://relay.example"],
        senderPubkey: OTHER_HEX_PUBKEY,
      },
      derivedPubkey: HEX_PUBKEY,
      hasRecipientPubkey: false,
      recipientPubkeys: [HEX_PUBKEY, OTHER_HEX_PUBKEY],
      senderPub: { hex: OTHER_HEX_PUBKEY, npub: NPUB },
    });

    const stored = await readPushDebugLog();

    expect(stored).toHaveLength(1);
    expect(stored[0]?.details).toEqual({
      data: {
        outerEventId: WRAP_ID,
        recipientNpub: "[redacted]",
        recipientPubkey: "[redacted]",
        relayHints: ["wss://relay.example"],
        senderPubkey: "[redacted]",
      },
      derivedPubkey: "[redacted]",
      hasRecipientPubkey: false,
      recipientPubkeys: ["[redacted]", "[redacted]"],
      senderPub: { hex: "[redacted]", npub: "[redacted]" },
    });
  });

  it("redacts identities embedded in free text and errors", async () => {
    appendPushDebugLog("client", "outbox job failed", {
      detail: `enqueued under ${HEX_PUBKEY}, current identity is ${OTHER_HEX_PUBKEY}`,
      error: new Error(`no contact for ${NPUB}`),
      href: `https://app.linky.fit/#chat/unknown:${HEX_PUBKEY}`,
      title: `Linky - ${NPUB.slice(0, 10)}…${NPUB.slice(-6)}`,
    });

    const stored = await readPushDebugLog();
    const serialized = JSON.stringify(stored);

    expect(serialized).not.toContain(HEX_PUBKEY);
    expect(serialized).not.toContain(OTHER_HEX_PUBKEY);
    expect(serialized).not.toContain(NPUB.slice(0, 20));
    expect(stored[0]?.details).toMatchObject({
      detail:
        "enqueued under [redacted 32-byte value], current identity is [redacted 32-byte value]",
      error: { message: "no contact for [redacted npub]", name: "Error" },
      href: "https://app.linky.fit/",
    });
  });

  it("keeps bare ids and diagnostics that carry no identity", async () => {
    appendPushDebugLog("sw", "sw decrypt failed", {
      hasRecipientPubkey: false,
      isCashuMessage: true,
      outerEventId: WRAP_ID,
      recipientPubkeyFingerprint: HEX_PUBKEY.slice(0, 8),
      tag: WRAP_ID,
    });

    const stored = await readPushDebugLog();

    expect(stored[0]?.details).toEqual({
      hasRecipientPubkey: false,
      isCashuMessage: true,
      outerEventId: WRAP_ID,
      recipientPubkeyFingerprint: HEX_PUBKEY.slice(0, 8),
      tag: WRAP_ID,
    });
  });

  it("redacts entries an earlier build stored in the clear", async () => {
    entries.set(
      PUSH_LOG_URL,
      JSON.stringify([
        {
          details: { senderPubkey: HEX_PUBKEY },
          message: "sw decrypt succeeded",
          source: "sw",
          timestamp: "2026-09-14T00:00:00.000Z",
        },
      ]),
    );

    const stored = await readPushDebugLog();

    expect(stored).toHaveLength(1);
    expect(stored[0]?.details).toEqual({ senderPubkey: "[redacted]" });
    expect(entries.get(PUSH_LOG_URL)).toContain(HEX_PUBKEY);

    appendPushDebugLog("sw", "service worker activate");
    await readPushDebugLog();

    expect(entries.get(PUSH_LOG_URL)).not.toContain(HEX_PUBKEY);
  });
});
