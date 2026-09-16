import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { Agent } from "undici/index.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RequestDetails } from "web-push";

import { isPublicAddress, parsePushEndpoint } from "./endpoint";
import {
  MAX_PUSH_RESPONSE_BYTES,
  postPushRequest,
  sendWebPushRequest,
} from "./webPushTransport";

const details: RequestDetails = {
  endpoint: "https://push.example.test/send",
  method: "POST",
  headers: { TTL: "60", "Content-Type": "application/octet-stream" },
  body: Buffer.from("encrypted notification"),
};

let cert: Buffer;
let key: Buffer;
let directory: string;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "linky-push-tls-"));
  const generated = Bun.spawnSync([
    "openssl",
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=push.example.test",
    "-addext",
    "subjectAltName=DNS:push.example.test",
    "-keyout",
    join(directory, "key.pem"),
    "-out",
    join(directory, "cert.pem"),
  ]);
  if (generated.exitCode !== 0) throw new Error(generated.stderr.toString());
  cert = readFileSync(join(directory, "cert.pem"));
  key = readFileSync(join(directory, "key.pem"));
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("web push egress policy", () => {
  it("rejects private, metadata, mapped, and transition addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "100.64.0.1",
      "192.168.1.1",
      "::1",
      "::ffff:127.0.0.1",
      "64:ff9b::7f00:1",
      "2002:7f00:1::",
      "2001::1",
      "fe80::1",
      "fc00::1",
      "2001:db8::1",
    ]) {
      expect(isPublicAddress(address)).toBe(false);
    }
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/token",
      "https://updates.push.services.mozilla.com/wpush/v2/token",
      "https://web.push.apple.com/token",
    ]) {
      expect(parsePushEndpoint(endpoint).protocol).toBe("https:");
    }
  });

  it("checks every DNS answer on every delivery before making a request", async () => {
    const sent: string[] = [];
    let answers = [{ address: "8.8.8.8", family: 4 }];
    let lookups = 0;
    const network = {
      lookup: async () => {
        lookups += 1;
        return answers;
      },
      post: async (
        _url: URL,
        addresses: { address: string; family: number }[],
      ) => {
        sent.push(...addresses.map(({ address }) => address));
      },
    };
    await sendWebPushRequest(details, network);
    expect(sent).toEqual(["8.8.8.8"]);
    answers = [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    await expect(sendWebPushRequest(details, network)).rejects.toThrow(
      "non-public",
    );
    answers = [];
    await expect(sendWebPushRequest(details, network)).rejects.toThrow(
      "non-public",
    );
    expect(lookups).toBe(3);
    expect(sent).toEqual(["8.8.8.8"]);
  });
});

describe("actual HTTPS transport", () => {
  async function withProvider(
    run: (url: URL, seen: string[], receivedHosts: string[]) => Promise<void>,
  ) {
    const seen: string[] = [];
    const receivedHosts: string[] = [];
    const provider = createServer({ cert, key }, (req, res) => {
      seen.push(req.url ?? "");
      receivedHosts.push(req.headers.host ?? "");
      req.resume();
      if (req.url === "/redirect") {
        res.writeHead(307, { location: "/must-not-follow" });
        res.end();
      } else if (req.url === "/large") {
        res.writeHead(400);
        res.write(Buffer.alloc(MAX_PUSH_RESPONSE_BYTES));
        res.end(Buffer.alloc(1));
      } else if (req.url === "/gone") {
        res.writeHead(410);
        res.end("expired");
      } else if (req.url === "/slow") {
        res.writeHead(200);
        res.write("waiting");
      } else {
        res.writeHead(201);
        res.end("accepted");
      }
    });
    await new Promise<void>((resolve) =>
      provider.listen(0, "127.0.0.1", resolve),
    );
    const address = provider.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test server address");
    try {
      await run(
        new URL(`https://push.example.test:${address.port}/send`),
        seen,
        receivedHosts,
      );
    } finally {
      provider.closeAllConnections();
    }
  }

  const post = (url: URL, signal = AbortSignal.timeout(2000)) =>
    postPushRequest(
      url,
      [{ address: "127.0.0.1", family: 4 }],
      details,
      signal,
      (lookup) => new Agent({ connect: { lookup, ca: cert } }),
    );

  it("uses the pinned address while preserving HTTPS hostname validation", async () => {
    await withProvider(async (url, seen, receivedHosts) => {
      await post(url);
      expect(receivedHosts).toEqual([url.host]);
      expect(seen).toEqual(["/send"]);
      url.hostname = "wrong.example.test";
      await expect(post(url)).rejects.toThrow();
      expect(seen).toEqual(["/send"]);
    });
  });

  it("does not follow a redirect and retains bounded provider errors", async () => {
    await withProvider(async (url, seen) => {
      url.pathname = "/redirect";
      await expect(post(url)).rejects.toMatchObject({ statusCode: 307 });
      expect(seen).toEqual(["/redirect"]);
      url.pathname = "/gone";
      await expect(post(url)).rejects.toMatchObject({
        statusCode: 410,
        body: "expired",
      });
    });
  });

  it("aborts oversized and stalled provider responses", async () => {
    await withProvider(async (url) => {
      url.pathname = "/large";
      await expect(post(url)).rejects.toThrow("size limit");
      url.pathname = "/slow";
      await expect(post(url, AbortSignal.timeout(50))).rejects.toThrow();
    });
  });
});
