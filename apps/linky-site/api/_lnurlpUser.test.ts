import { beforeEach, describe, expect, it, vi } from "vitest";

import handler from "./lnurlp/[user].js";

const { undiciFetch } = vi.hoisted(() => ({
  undiciFetch: vi.fn<(url: URL) => Promise<Response>>(),
}));

vi.mock("node:dns", () => ({
  promises: {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  },
}));

vi.mock("undici/index.js", () => ({
  Agent: class {
    close = async (): Promise<void> => {};
  },
  fetch: undiciFetch,
}));

const run = async (
  query: Record<string, string>,
  headers: Record<string, string> = { host: "linky.fit" },
): Promise<Record<string, unknown>> => {
  let body = "";
  await handler(
    { method: "GET", query, headers },
    {
      setHeader: () => {},
      status: () => ({
        json: (json) => {
          body = JSON.stringify(json);
        },
        send: (text) => {
          body = text;
        },
      }),
    },
  );
  return JSON.parse(body);
};

const upstreamReturns = (body: Record<string, unknown>): void => {
  undiciFetch.mockResolvedValue(
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    }),
  );
};

const metadataOf = (payRequest: Record<string, unknown>): unknown =>
  JSON.parse(String(payRequest.metadata));

beforeEach(() => {
  undiciFetch.mockReset();
});

describe("linky.fit lnurlp proxy", () => {
  it("rewrites the callback and the LUD-16 identifier, keeping other fields and entries", async () => {
    upstreamReturns({
      tag: "payRequest",
      callback: "https://npub.linky.fit/.well-known/lnurlp/Alice",
      minSendable: 1000,
      maxSendable: 100000000,
      allowsNostr: true,
      nostrPubkey: "f".repeat(64),
      metadata: JSON.stringify([
        ["text/plain", "Neat!"],
        ["text/identifier", "Alice@npub.linky.fit"],
        ["x-extension", { any: "json" }, 3],
      ]),
    });

    const payRequest = await run(
      { user: "Alice" },
      { host: "staging.linky.fit" },
    );

    expect(payRequest).toMatchObject({
      callback: "https://staging.linky.fit/.well-known/lnurlp/Alice",
      minSendable: 1000,
      maxSendable: 100000000,
      allowsNostr: true,
      nostrPubkey: "f".repeat(64),
    });
    expect(metadataOf(payRequest)).toEqual([
      ["text/plain", "Neat!"],
      ["text/identifier", "alice@staging.linky.fit"],
      ["x-extension", { any: "json" }, 3],
    ]);
  });

  it("leaves the identifier when the public host cannot be parsed", async () => {
    const metadata = JSON.stringify([
      ["text/identifier", "alice@npub.linky.fit"],
    ]);
    upstreamReturns({ tag: "payRequest", metadata });

    const payRequest = await run(
      { user: "alice" },
      { host: "linky.fit", "x-forwarded-proto": "https, https" },
    );

    expect(payRequest.metadata).toBe(metadata);
  });

  it("adds no identifier when the upstream sends none", async () => {
    const metadata = JSON.stringify([["text/plain", "Neat!"]]);
    upstreamReturns({ tag: "payRequest", metadata });

    expect((await run({ user: "alice" })).metadata).toBe(metadata);
  });

  it.each([
    undefined,
    "not json",
    JSON.stringify({ text: "plain" }),
    JSON.stringify(["text/identifier", "alice@npub.linky.fit"]),
  ])("leaves metadata %s unchanged", async (metadata) => {
    upstreamReturns({ tag: "payRequest", metadata });

    expect((await run({ user: "alice" })).metadata).toBe(metadata);
  });

  it("passes the invoice response through untouched", async () => {
    const invoice = {
      pr: "lnbc1...",
      metadata: JSON.stringify([["text/identifier", "alice@npub.linky.fit"]]),
      callback: "https://npub.linky.fit/cb",
    };
    upstreamReturns(invoice);

    const zapRequest = JSON.stringify({ kind: 9734, tags: [] });
    expect(
      await run({ user: "alice", amount: "21000", nostr: zapRequest }),
    ).toEqual(invoice);
    const upstreamUrl = undiciFetch.mock.calls[0]?.[0];
    expect(upstreamUrl?.pathname).toBe("/.well-known/lnurlp/alice");
    expect(upstreamUrl?.searchParams.get("amount")).toBe("21000");
    expect(upstreamUrl?.searchParams.get("nostr")).toBe(zapRequest);
  });
});
