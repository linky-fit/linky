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
): Promise<Record<string, unknown>> => {
  let body = "";
  await handler(
    { method: "GET", query, headers: { host: "linky.fit" } },
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
  it("rewrites the callback and the LUD-16 identifier, keeping other entries in order", async () => {
    upstreamReturns({
      tag: "payRequest",
      callback: "https://npub.linky.fit/.well-known/lnurlp/Alice",
      metadata: JSON.stringify([
        ["text/plain", "Neat!"],
        ["text/identifier", "Alice@npub.linky.fit"],
        ["image/png;base64", "iVBOR"],
      ]),
    });

    const payRequest = await run({ user: "Alice" });

    expect(payRequest.callback).toBe(
      "https://linky.fit/.well-known/lnurlp/Alice",
    );
    expect(metadataOf(payRequest)).toEqual([
      ["text/plain", "Neat!"],
      ["text/identifier", "alice@linky.fit"],
      ["image/png;base64", "iVBOR"],
    ]);
  });

  it("adds no identifier when the upstream sends none", async () => {
    const metadata = JSON.stringify([["text/plain", "Neat!"]]);
    upstreamReturns({ tag: "payRequest", metadata });

    expect((await run({ user: "alice" })).metadata).toBe(metadata);
  });

  it.each([undefined, "not json", JSON.stringify({ text: "plain" })])(
    "leaves metadata %s unchanged",
    async (metadata) => {
      upstreamReturns({ tag: "payRequest", metadata });

      expect((await run({ user: "alice" })).metadata).toBe(metadata);
    },
  );

  it("passes the invoice response through untouched", async () => {
    const invoice = {
      pr: "lnbc1...",
      metadata: JSON.stringify([["text/identifier", "alice@npub.linky.fit"]]),
      callback: "https://npub.linky.fit/cb",
    };
    upstreamReturns(invoice);

    expect(await run({ user: "alice", amount: "21000" })).toEqual(invoice);
    expect(undiciFetch.mock.calls[0]?.[0].href).toBe(
      "https://npub.linky.fit/.well-known/lnurlp/alice?amount=21000",
    );
  });
});
