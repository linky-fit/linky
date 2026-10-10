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

const PUBKEY =
  "b5aebd498819f6ba9eb5875277ca9293884d25a42be06870cbadd2c3873fa94b";

const upstreamAnswers = (names: Record<string, string>) =>
  safeFetch.mockResolvedValue({
    status: 200,
    text: JSON.stringify({ names, relays: {} }),
    contentType: "application/json",
  });

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
  upstreamAnswers({});
});

describe("nostr.json handler", () => {
  it("adds the write relays of a bought name and caches the answer", async () => {
    upstreamAnswers({ hynek: PUBKEY });
    relayList.tags = [
      ["r", "wss://write.example.com", "write"],
      ["r", "wss://both.example.com"],
      ["r", "wss://read.example.com", "read"],
      ["r", "http://plain.example.com"],
      ["p", "wss://not-a-relay-tag.example.com"],
    ];

    expect(await run({ name: "hynek" })).toEqual({
      status: 200,
      body: {
        names: { hynek: PUBKEY },
        relays: {
          [PUBKEY]: ["wss://write.example.com", "wss://both.example.com"],
        },
      },
      cacheControl: "public, s-maxage=300, stale-while-revalidate=3600",
    });
  });

  it("answers a bought name without a relay list but caches it only briefly", async () => {
    upstreamAnswers({ hynek: PUBKEY });

    expect(await run({ name: "hynek" })).toEqual({
      status: 200,
      body: { names: { hynek: PUBKEY }, relays: {} },
      cacheControl: "public, s-maxage=60",
    });
  });

  it("passes an unknown name through uncached without asking relays", async () => {
    relayList.tags = [["r", "wss://write.example.com"]];

    expect(await run({ name: "nobody" })).toEqual({
      status: 200,
      body: { names: {}, relays: {} },
      cacheControl: "no-store",
    });
    expect(safeFetch.mock.calls[0]?.[0].searchParams.get("name")).toBe(
      "nobody",
    );
  });
});
