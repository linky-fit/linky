import { beforeEach, describe, expect, it, vi } from "vitest";

import handler from "./lnurlp.js";

const { lookup, undiciFetch } = vi.hoisted(() => ({
  lookup:
    vi.fn<
      (hostname: string) => Promise<{ address: string; family: number }[]>
    >(),
  undiciFetch: vi.fn<(url: URL) => Promise<Response>>(),
}));

vi.mock("node:dns", () => ({ promises: { lookup } }));

vi.mock("undici", () => ({
  Agent: class {
    close = async (): Promise<void> => {};
  },
  fetch: undiciFetch,
}));

interface Sent {
  status: number;
  body: string;
  headers: Record<string, string>;
}

const run = async (query: Record<string, string>): Promise<Sent> => {
  const sent: Sent = { status: 0, body: "", headers: {} };
  await handler(
    { query },
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
  return sent;
};

const jsonResponse = (body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  lookup.mockReset();
  undiciFetch.mockReset();
  undiciFetch.mockImplementation(async (url) => {
    throw new Error(`unexpected connection to ${url.href}`);
  });
});

describe("lnurlp handler", () => {
  it.each([
    "alice",
    "alice@%.example.com",
    "alice@example.com#ignored",
    "alice@example.com?ignored",
    "alice@example.com\\ignored",
    "alice@127.0.0.1",
    "alice@[::1]",
    "alice@localhost",
    "alice@wallet.localhost",
    "alice@printer.local",
    "alice@metadata.internal",
    "alice@example.com:8443",
    "alice@example.com/path",
  ])("answers 400 for %s without resolving anything", async (address) => {
    const sent = await run({ address });

    expect(sent.status).toBe(400);
    expect(JSON.parse(sent.body)).toEqual({
      error: "Invalid lightning address",
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it("answers 400 for a malformed amount", async () => {
    const sent = await run({ address: "alice@example.com", amount: "12abc" });

    expect(sent.status).toBe(400);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects a host that resolves to loopback before any connection", async () => {
    lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

    const sent = await run({ address: "alice@127.0.0.1.nip.io" });

    expect(sent.status).toBe(502);
    expect(JSON.parse(sent.body)).toMatchObject({
      error: "Proxy fetch failed",
      detail: expect.stringContaining("non-public"),
    });
    expect(lookup).toHaveBeenCalledWith("127.0.0.1.nip.io", { all: true });
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it("rejects a callback that resolves to a private address", async () => {
    lookup.mockImplementation(async (hostname) => [
      hostname === "pay.example.com"
        ? { address: "93.184.216.34", family: 4 }
        : { address: "10.0.0.5", family: 4 },
    ]);
    undiciFetch.mockResolvedValueOnce(
      jsonResponse({ callback: "https://10.0.0.5.nip.io/cb" }),
    );

    const sent = await run({
      address: "alice@pay.example.com",
      amount: "1000",
    });

    expect(sent.status).toBe(502);
    expect(undiciFetch).toHaveBeenCalledTimes(1);
  });

  it("performs both hops against public hosts and forwards amount and comment", async () => {
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    undiciFetch
      .mockResolvedValueOnce(
        jsonResponse({ callback: "https://pay.example.com/cb" }),
      )
      .mockResolvedValueOnce(jsonResponse({ pr: "lnbc1..." }));

    const sent = await run({
      address: "Alice@Pay.Example.com",
      amount: "21000",
      comment: "thanks",
    });

    expect(sent.status).toBe(200);
    expect(JSON.parse(sent.body)).toEqual({ pr: "lnbc1..." });
    expect(sent.headers["Content-Type"]).toBe("application/json");
    expect(undiciFetch.mock.calls.map(([url]) => url.href)).toEqual([
      "https://pay.example.com/.well-known/lnurlp/alice",
      "https://pay.example.com/cb?amount=21000&comment=thanks",
    ]);
  });
});
