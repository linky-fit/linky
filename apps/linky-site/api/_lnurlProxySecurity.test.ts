import { beforeEach, describe, expect, it, vi } from "vitest";
import siteHandler from "./lnurlp.js";
import appHandler from "../../web-app/api/lnurlp.js";

const { lookup, undiciFetch } = vi.hoisted(() => ({
  lookup: vi.fn<() => Promise<{ address: string; family: number }[]>>(),
  undiciFetch: vi.fn<() => Promise<Response>>(),
}));
vi.mock("node:dns", () => ({ promises: { lookup } }));
vi.mock("undici/index.js", () => ({
  Agent: class {
    close = async (): Promise<void> => {};
  },
  fetch: undiciFetch,
}));

beforeEach(() => {
  vi.resetAllMocks();
  lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

for (const [name, handler, query] of [
  ["site", siteHandler, { address: "alice@example.com" }],
  ["app", appHandler, { url: "https://example.com/lnurl" }],
] satisfies [string, typeof siteHandler, Record<string, string>][]) {
  describe(`${name} LNURL proxy security`, () => {
    const run = async (method = "GET", origin?: string) => {
      const sent = { status: 0, body: "", headers: new Headers() };
      await handler(
        { method, query, headers: origin ? { origin } : {} },
        {
          setHeader: (name, value) => sent.headers.set(name, value),
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

    it.each(["POST", "PUT", "OPTIONS", "HEAD"])(
      "rejects %s before contacting upstream",
      async (method) => {
        const sent = await run(method);
        expect(sent.status).toBe(405);
        expect(sent.headers.get("Allow")).toBe("GET");
        expect(lookup).not.toHaveBeenCalled();
        expect(undiciFetch).not.toHaveBeenCalled();
      },
    );

    it.each([
      "<html><script>alert(1)</script></html>",
      "null",
      "[]",
      '"<script>alert(1)</script>"',
    ])("does not reflect non-object JSON or HTML: %s", async (body) => {
      undiciFetch.mockResolvedValue(
        new Response(body, { headers: { "content-type": "text/html" } }),
      );
      const sent = await run();
      expect(sent.status).toBe(502);
      expect(sent.body).not.toContain("<script>");
      expect(sent.headers.get("Content-Type")).toBe(
        "application/json; charset=utf-8",
      );
      expect(sent.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });

    it("re-serializes JSON with fixed safe headers even if the upstream claims HTML", async () => {
      undiciFetch.mockResolvedValue(
        new Response(' { "status" : "OK" } ', {
          headers: { "content-type": "text/html" },
        }),
      );
      const sent = await run();
      expect(sent.status).toBe(200);
      expect(sent.body).toBe('{"status":"OK"}');
      expect(sent.headers.get("Content-Type")).toBe(
        "application/json; charset=utf-8",
      );
      expect(sent.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(sent.headers.get("Cache-Control")).toBe("no-store");
    });

    it("rejects private DNS answers before connecting", async () => {
      lookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
      expect((await run()).status).toBe(502);
      expect(undiciFetch).not.toHaveBeenCalled();
    });

    it("rejects redirects to private networks", async () => {
      undiciFetch.mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/admin" },
        }),
      );
      expect((await run()).status).toBe(502);
      expect(undiciFetch).toHaveBeenCalledTimes(1);
    });

    it("does not grant CORS access to arbitrary origins", async () => {
      undiciFetch.mockResolvedValue(new Response('{"status":"OK"}'));
      const sent = await run("GET", "https://attacker.example");
      expect(sent.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    if (name === "app") {
      it.each(["https://localhost", "capacitor://localhost"])(
        "preserves native shell CORS for %s",
        async (origin) => {
          undiciFetch.mockResolvedValue(new Response('{"status":"OK"}'));
          const sent = await run("GET", origin);
          expect(sent.headers.get("Access-Control-Allow-Origin")).toBe(origin);
          expect(sent.headers.get("Vary")).toBe("Origin");
        },
      );
    }

    it("caps the decoded response body", async () => {
      undiciFetch.mockResolvedValue(
        new Response(JSON.stringify({ data: "a".repeat(65536) })),
      );
      expect((await run()).status).toBe(502);
    });
  });
}
