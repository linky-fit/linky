import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { Schema } from "effect";

/** Verifies live update manifests; CI signs them with the matching `LIVE_UPDATE_SIGNING_KEY`. */
export const LIVE_UPDATE_PUBLIC_KEY =
  "306540c49962995cbe207e9b14bfb345bd0f783292c32f500283d727cdb9b342";

const Sha256Hex = Schema.String.pipe(Schema.pattern(/^[0-9a-f]{64}$/));

/** The native runtime a web build was made for, shipped as `native-runtime.json` next to its `index.html`. */
export const NativeRuntimeFile = Schema.Struct({
  runtime: Schema.NonEmptyString,
});

/** A signed pointer to the zipped web bundle built for one native runtime. */
export const LiveUpdateManifest = Schema.Struct({
  runtime: Schema.NonEmptyString,
  version: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
  sha256: Sha256Hex,
  signature: Schema.String,
});
export type LiveUpdateManifest = typeof LiveUpdateManifest.Type;

type UnsignedLiveUpdateManifest = Omit<LiveUpdateManifest, "signature">;

export const liveUpdateAssetName = (
  runtime: string,
  extension: "json" | "zip",
) => `live-update-${runtime}.${extension}`;

// The URL is left unsigned: the bundle it serves is pinned by sha256.
const signedMessage = (manifest: UnsignedLiveUpdateManifest): Uint8Array =>
  new TextEncoder().encode(
    `linky-live-update\n${manifest.runtime}\n${manifest.version}\n${manifest.sha256}`,
  );

export const bundleSha256 = (bundle: Uint8Array): string =>
  bytesToHex(sha256(bundle));

export const liveUpdatePublicKey = (secretKeyHex: string): string =>
  bytesToHex(ed25519.getPublicKey(hexToBytes(secretKeyHex)));

export const signLiveUpdateManifest = (
  manifest: UnsignedLiveUpdateManifest,
  secretKeyHex: string,
): LiveUpdateManifest => ({
  ...manifest,
  signature: bytesToHex(
    ed25519.sign(signedMessage(manifest), hexToBytes(secretKeyHex)),
  ),
});

export const verifyLiveUpdateManifest = (
  manifest: LiveUpdateManifest,
  publicKeyHex: string,
): boolean => {
  try {
    return ed25519.verify(
      hexToBytes(manifest.signature),
      signedMessage(manifest),
      hexToBytes(publicKeyHex),
    );
  } catch {
    return false;
  }
};

const versionParts = (version: string): number[] =>
  version.split(".").map((part) => Number.parseInt(part, 10));

/** Compares CalVer `YY.M.MICRO` versions part by part. */
export const isNewerVersion = (candidate: string, current: string): boolean => {
  const next = versionParts(candidate);
  const running = versionParts(current);
  for (let index = 0; index < Math.max(next.length, running.length); index++) {
    const difference = (next[index] ?? 0) - (running[index] ?? 0);
    if (Number.isNaN(difference)) return false;
    if (difference !== 0) return difference > 0;
  }
  return false;
};
