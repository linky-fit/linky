import { describe, expect, it } from "vitest";
import { createMonetaRelay } from "./moneta";

const token = `Bearer ${"t".repeat(20)}`;

/** A relay over a recording bank that answers every call with `answer`. */
const relayOver = (
  answer: () => Response | Promise<Response> = () =>
    new Response('{"accounts":[]}', {
      status: 200,
      headers: { "content-type": "application/json;charset=UTF-8" },
    }),
) => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const relay = createMonetaRelay(async (input, init) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return answer();
  });
  const headers: Record<string, string> = {};
  let sent: { status: number; body: unknown } | null = null;
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    status: (status: number) => ({
      json: (body: Record<string, unknown>) => {
        sent = { status, body };
      },
      send: (body: string) => {
        sent = { status, body };
      },
    }),
  };
  return {
    calls,
    headers,
    sent: () => sent,
    run: (req: Parameters<typeof relay>[0]) => relay(req, res),
  };
};

describe("the MONETA relay", () => {
  it("forwards a history call with the token and the known query, and answers with the bank's body", async () => {
    const relay = relayOver();
    await relay.run({
      method: "GET",
      query: {
        path: "accounts/ab-12/transactions",
        fromDate: "2026-10-29T00:00:00+01:00",
        toDate: ["2026-10-30T09:00:00+01:00"],
        page: "0",
        size: "100",
        sort: "amount",
        "x-evil": "1",
      },
      headers: { authorization: token, cookie: "session=1" },
    });
    expect(relay.calls).toEqual([
      {
        url: "https://api.moneta.cz/api/v4/vip/aisp/my/accounts/ab-12/transactions?fromDate=2026-10-29T00%3A00%3A00%2B01%3A00&toDate=2026-10-30T09%3A00%3A00%2B01%3A00&page=0&size=100",
        headers: { authorization: token, accept: "application/json" },
      },
    ]);
    expect(relay.sent()).toEqual({ status: 200, body: '{"accounts":[]}' });
    expect(relay.headers).toEqual({
      "Cache-Control": "no-store",
      "Content-Type": "application/json;charset=UTF-8",
    });
  });

  it("refuses other methods, other paths and a missing token without calling the bank", async () => {
    const relay = relayOver();
    await relay.run({
      method: "POST",
      query: { path: "accounts" },
      headers: { authorization: token },
    });
    expect(relay.sent()?.status).toBe(405);
    for (const path of [
      "",
      "payments",
      "accounts/x",
      "accounts/../psd/pisp/my/payments",
      "accounts/x/transactions/y",
    ]) {
      await relay.run({
        method: "GET",
        query: { path },
        headers: { authorization: token },
      });
      expect(relay.sent()?.status).toBe(404);
    }
    await relay.run({
      method: "GET",
      query: { path: "accounts" },
      headers: {},
    });
    expect(relay.sent()?.status).toBe(401);
    await relay.run({
      method: "GET",
      query: { path: "accounts" },
      headers: { authorization: "Basic abc" },
    });
    expect(relay.sent()?.status).toBe(401);
    expect(relay.calls).toEqual([]);
  });

  it("passes the bank's status through and answers 502 when the bank does not answer", async () => {
    const refused = relayOver(
      () =>
        new Response("<fault/>", {
          status: 401,
          headers: { "content-type": "text/xml" },
        }),
    );
    await refused.run({
      method: "GET",
      query: { path: "accounts" },
      headers: { authorization: token },
    });
    expect(refused.sent()).toEqual({ status: 401, body: "<fault/>" });
    expect(refused.headers["Content-Type"]).toBe("text/xml");

    const down = relayOver(() => Promise.reject(new Error("timeout")));
    await down.run({
      method: "GET",
      query: { path: "accounts" },
      headers: { authorization: token },
    });
    expect(down.sent()).toEqual({
      status: 502,
      body: { error: "Bank unreachable" },
    });
  });
});
