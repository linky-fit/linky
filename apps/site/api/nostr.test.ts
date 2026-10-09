import { beforeEach, describe, expect, it, vi } from "vitest";

import handler from "./nostr.js";

const { safeFetch, relayList } = vi.hoisted(() => {
  const relayList: { tags: string[][] | null } = { tags: null };
  return {
    safeFetch: vi.fn<typeof import("./_safeFetch.js").safeFetch>(),
    relayList,
  };
});
vi.mock("./_safeFetch.js", () => ({ safeFetch }));
vi.mock("nostr-tools/pool", () => ({
  SimplePool: class {
    get = async () => (relayList.tags ? { tags: relayList.tags } : null);
    destroy = () => {};
  },
}));

const NPUB = "npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8";
const PUBKEY =
  "b5aebd498819f6ba9eb5875277ca9293884d25a42be06870cbadd2c3873fa94b";

const run = async (query: Record<string, string>) => {
  const headers: Record<string, string> = {};
  const sent = { status: 0, body: "", headers };
  await handler(
    { method: "GET", query },
    {
      setHeader: (name, value) => {
        sent.headers[name] = value;
      },
      status: (code) => {
        sent.status = code;
        return {
          json: (body) => {
            sent.body = JSON.stringify(body);
          },
          send: (body) => {
            sent.body = body;
          },
        };
      },
    },
  );
  return {
    status: sent.status,
    body: JSON.parse(sent.body),
    cacheControl: sent.headers["Cache-Control"],
  };
};

beforeEach(() => {
  relayList.tags = null;
  safeFetch.mockReset();
  safeFetch.mockResolvedValue({
    status: 200,
    text: JSON.stringify({ names: {}, relays: {} }),
    contentType: "application/json",
  });
});

describe("nostr.json handler", () => {
  it("vouches for an npub name with its write relays and caches the answer", async () => {
    relayList.tags = [
      ["r", "wss://write.example.com", "write"],
      ["r", "wss://both.example.com"],
      ["r", "wss://read.example.com", "read"],
      ["r", "http://plain.example.com"],
      ["p", "wss://not-a-relay-tag.example.com"],
    ];

    for (const name of [NPUB, NPUB.toUpperCase()]) {
      expect(await run({ name })).toEqual({
        status: 200,
        body: {
          names: { [NPUB]: PUBKEY },
          relays: {
            [PUBKEY]: ["wss://write.example.com", "wss://both.example.com"],
          },
        },
        cacheControl: "public, s-maxage=3600, stale-while-revalidate=86400",
      });
    }
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("still vouches without a relay list but caches only briefly", async () => {
    expect(await run({ name: NPUB })).toEqual({
      status: 200,
      body: { names: { [NPUB]: PUBKEY }, relays: {} },
      cacheControl: "public, s-maxage=60",
    });
  });

  it("forwards claimed names and invalid npubs to the npub.cash server", async () => {
    await run({ name: "hynek" });
    await run({ name: `${NPUB.slice(0, -1)}x` });

    expect(
      safeFetch.mock.calls.map(([url]) => url.searchParams.get("name")),
    ).toEqual(["hynek", `${NPUB.slice(0, -1)}x`]);
  });
});
