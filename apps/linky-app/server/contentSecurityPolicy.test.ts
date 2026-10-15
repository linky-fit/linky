// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { build } from "vite";
import { afterEach, expect, it, vi } from "vitest";
import { bootDiagnosticRedaction } from "./bootDiagnosticRedaction";
import { contentSecurityPolicyMeta } from "./contentSecurityPolicy";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

it.each(["0", "1"])(
  "hashes final scripts and gates local connections with flag %s",
  async (flag) => {
    vi.stubEnv("VITE_ALLOW_INSECURE_LOCALHOST_RELAYS", flag);
    const root = await realpath(await mkdtemp(join(tmpdir(), "linky-csp-")));
    roots.push(root);
    await writeFile(
      join(root, "index.html"),
      "<html><head><title>Linky</title></head><body><script>window.booted = true;</script></body></html>",
    );
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [contentSecurityPolicyMeta(), bootDiagnosticRedaction()],
    });
    const html = await readFile(join(root, "dist/index.html"), "utf8");
    const document = new JSDOM(html).window.document;
    const meta = document.querySelector(
      'meta[http-equiv="Content-Security-Policy"]',
    );
    expect(document.head.firstElementChild).toBe(meta);
    const policy = meta?.getAttribute("content") ?? "";
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain(
      "style-src 'self' 'unsafe-inline'; font-src 'self';",
    );
    expect(policy).not.toContain("fonts.googleapis.com");
    const scripts = document.querySelectorAll("script:not([src])");
    expect(scripts).toHaveLength(2);
    for (const script of scripts) {
      const hash = createHash("sha256")
        .update(script.textContent)
        .digest("base64");
      expect(policy).toContain(`'sha256-${hash}'`);
    }
    expect(policy.includes("http://localhost:*")).toBe(flag === "1");
    expect(policy.includes("ws://127.0.0.1:*")).toBe(flag === "1");
    expect(policy.split(/\s+/)).not.toContain("http:");
    expect(policy.split(/\s+/)).not.toContain("ws:");
  },
);
