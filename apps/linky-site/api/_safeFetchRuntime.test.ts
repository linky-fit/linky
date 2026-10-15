import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const run = promisify(execFile);

it("pins actual Bun TLS connections to the validated address without re-resolving", async () => {
  const directory = await mkdtemp(join(tmpdir(), "linky-pinned-tls-"));
  const keyPath = join(directory, "key.pem");
  const certPath = join(directory, "cert.pem");
  try {
    await run("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-subj",
      "/CN=pinning.invalid",
      "-addext",
      "subjectAltName=DNS:pinning.invalid",
    ]);
    const { stdout } = await run(
      "bun",
      [
        fileURLToPath(
          new URL("../tests/fixtures/pinnedTransport.ts", import.meta.url),
        ),
        keyPath,
        certPath,
      ],
      {
        env: { ...process.env, NODE_EXTRA_CA_CERTS: certPath },
        timeout: 15_000,
      },
    );
    expect(stdout).toContain(
      "Connected to the pinned TLS address with the original hostname verified.",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
