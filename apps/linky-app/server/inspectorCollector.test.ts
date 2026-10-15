// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectorCollector } from "./inspectorCollector";

const report = JSON.stringify({
  client: "access-test",
  rows: [
    {
      at: 1,
      channel: "app.log",
      tag: "AccessTest",
      summary: "private diagnostic",
      links: {},
      payload: { message: "private diagnostic" },
    },
  ],
});

let server: ViteDevServer;
let root: string;
let origin: string;
let rowsFile: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "linky-inspector-"));
  const directory = path.join(root, ".inspector");
  await fs.mkdir(directory, { mode: 0o755 });
  rowsFile = path.join(directory, "rows-0.ndjson");
  await fs.writeFile(rowsFile, "old session", { mode: 0o644 });
  server = await createServer({
    configFile: false,
    root,
    plugins: [inspectorCollector()],
    server: { host: "127.0.0.1", port: 0 },
    optimizeDeps: { noDiscovery: true },
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("Vite did not expose a local URL");
  origin = new URL(url).origin;
});

afterAll(async () => {
  await server?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("inspector HTTP access", () => {
  it("keeps same-origin reporting, reading, streaming and clearing working", async () => {
    const headers = {
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
    };
    expect(
      (
        await fetch(`${origin}/__inspector/report`, {
          method: "POST",
          headers,
          body: report,
        })
      ).status,
    ).toBe(204);
    const events = await fetch(`${origin}/__inspector/events`, { headers });
    expect(events.status).toBe(200);
    expect(await events.text()).toContain("private diagnostic");
    const controller = new AbortController();
    const stream = await fetch(`${origin}/__inspector/stream`, {
      headers,
      signal: controller.signal,
    });
    expect(stream.status).toBe(200);
    const frame = await stream.body?.getReader().read();
    expect(new TextDecoder().decode(frame?.value)).toContain(
      "private diagnostic",
    );
    controller.abort();
    expect(
      (await fetch(`${origin}/__inspector/clear`, { method: "POST", headers }))
        .status,
    ).toBe(204);
    expect(await fs.readFile(rowsFile, "utf8")).toBe("");
  });

  it("rejects foreign, opaque and other localhost origins before reads or writes", async () => {
    await fetch(`${origin}/__inspector/report`, {
      method: "POST",
      body: report,
    });
    const before = await fs.readFile(rowsFile, "utf8");
    for (const foreignOrigin of [
      "https://attacker.example",
      "null",
      "http://localhost:1234",
    ]) {
      for (const [endpoint, method] of [
        ["events", "GET"],
        ["stream", "GET"],
        ["clear", "POST"],
        ["report", "POST"],
      ]) {
        const response = await fetch(`${origin}/__inspector/${endpoint}`, {
          method,
          headers: { Origin: foreignOrigin, "Content-Type": "text/plain" },
          ...(method === "POST" ? { body: report } : {}),
          signal: AbortSignal.timeout(2000),
        });
        expect(response.status, `${foreignOrigin} ${endpoint}`).toBe(403);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
        expect(await response.text()).not.toContain("private diagnostic");
      }
    }
    expect(await fs.readFile(rowsFile, "utf8")).toBe(before);
  });

  it("rejects cross-site requests without Origin while allowing curl", async () => {
    for (const site of ["cross-site", "same-site"]) {
      const response = await fetch(`${origin}/__inspector/clear`, {
        method: "POST",
        headers: { "Sec-Fetch-Site": site },
      });
      expect(response.status).toBe(403);
    }
    const response = await fetch(`${origin}/__inspector/events`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("private diagnostic");
  });

  it("cannot bypass the origin check after a successful Vite CORS preflight", async () => {
    const foreignOrigin = "http://localhost:1234";
    const preflight = await fetch(`${origin}/__inspector/clear`, {
      method: "OPTIONS",
      headers: {
        Origin: foreignOrigin,
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(preflight.status).toBe(204);
    const response = await fetch(`${origin}/__inspector/clear`, {
      method: "POST",
      headers: { Origin: foreignOrigin },
    });
    expect(response.status).toBe(403);
  });

  it("keeps Vite's host validation ahead of the collector", async () => {
    const response = await fetch(`${origin}/__inspector/events`, {
      headers: { Host: "attacker.example", Origin: "http://attacker.example" },
    });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("private diagnostic");
  });

  it("restricts existing log files and their directory to their owner", async () => {
    expect((await fs.stat(path.dirname(rowsFile))).mode & 0o777).toBe(0o700);
    expect((await fs.stat(rowsFile)).mode & 0o777).toBe(0o600);
  });
});
