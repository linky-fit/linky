// Captures the live demo publisher's artifacts byte-for-byte into
// src/__fixtures__/<host>/<path> for the offline tests: `bun run capture-fixtures`.
// It crawls without verifying anything; the tests do the verifying.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ORIGIN = "https://keryx-demo.github.io";
const JOIN_URL =
  "https://keryx-demo.github.io/join?p=eyJ2IjoxLCJjaGFubmVscyI6WyJzZWN1cml0eSIsIm5ld3MiLCJpbnNpZ2h0cyJdLCJwcml2YXRlX2ZlZWRzIjpbImh0dHBzOi8va2VyeXgtZGVtby5naXRodWIuaW8vY2hhbm5lbHMvdHJhY2tpbmcvbTEtNHpTREVtX0F2NzFjblYyNlpxUS9mZWVkLmpzb24iXX0";
const MEDIA = [
  `${ORIGIN}/media/logo.png`,
  `${ORIGIN}/media/order-2026-0841.txt`,
];
const fixtures = join(import.meta.dirname, "../src/__fixtures__");

const capture = async (url: string): Promise<Uint8Array | null> => {
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const { host, pathname } = new URL(url);
  const path = join(fixtures, host, pathname);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return bytes;
};

const captureJson = async (url: string) => {
  const bytes = await capture(url);
  if (bytes === null) throw new Error(`${url}: missing`);
  return JSON.parse(new TextDecoder().decode(bytes));
};

const root = await captureJson(`${ORIGIN}/.well-known/keryx/root.json`);
for (let version = 1; ; version++) {
  if (
    (await capture(`${ORIGIN}/.well-known/keryx/${version}.root.json`)) === null
  )
    break;
}
const base: string = root.signed.custom.repo_base;
await capture(new URL("timestamp.json", base).href);
const snapshot = await captureJson(new URL("snapshot.json", base).href);
for (const file of Object.keys(snapshot.signed.meta)) {
  const role = await captureJson(new URL(file, base).href);
  for (const path of Object.keys(role.signed.targets)) {
    await capture(new URL(path, base).href);
  }
}
const payload = JSON.parse(
  Buffer.from(
    new URL(JOIN_URL).searchParams.get("p") ?? "",
    "base64url",
  ).toString(),
);
for (const url of [...payload.private_feeds, ...MEDIA]) await capture(url);

writeFileSync(
  join(fixtures, "capture.json"),
  `${JSON.stringify({ capturedAt: new Date().toISOString(), joinUrl: JOIN_URL }, null, 2)}\n`,
);
