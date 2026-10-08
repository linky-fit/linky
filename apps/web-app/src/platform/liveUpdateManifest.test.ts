import { describe, expect, it } from "vitest";
import {
  bundleSha256,
  isNewerVersion,
  liveUpdatePublicKey,
  signLiveUpdateManifest,
  verifyLiveUpdateManifest,
} from "./liveUpdateManifest";

const secretKey = "01".repeat(32);
const publicKey = liveUpdatePublicKey(secretKey);
const manifest = signLiveUpdateManifest(
  {
    runtime: "0123456789abcdef",
    version: "26.10.4",
    url: "https://example.test/live-update-0123456789abcdef.zip",
    sha256: bundleSha256(new Uint8Array([1, 2, 3])),
  },
  secretKey,
);

describe("live update manifest", () => {
  it("verifies a manifest signed with the matching key", () => {
    expect(verifyLiveUpdateManifest(manifest, publicKey)).toBe(true);
  });

  it("rejects a manifest signed with another key", () => {
    expect(
      verifyLiveUpdateManifest(manifest, liveUpdatePublicKey("02".repeat(32))),
    ).toBe(false);
  });

  it.each([
    ["runtime", { runtime: "fedcba9876543210" }],
    ["version", { version: "26.10.5" }],
    ["bundle hash", { sha256: bundleSha256(new Uint8Array([4])) }],
    ["signature", { signature: "zz" }],
  ])("rejects a manifest whose %s changed after signing", (_, change) => {
    expect(
      verifyLiveUpdateManifest({ ...manifest, ...change }, publicKey),
    ).toBe(false);
  });

  it("accepts a changed URL, since the hash pins the bundle", () => {
    expect(
      verifyLiveUpdateManifest(
        { ...manifest, url: "https://mirror.test/bundle.zip" },
        publicKey,
      ),
    ).toBe(true);
  });
});

describe("isNewerVersion", () => {
  it.each([
    ["26.10.4", "26.10.3", true],
    ["26.10.10", "26.10.9", true],
    ["26.11.0", "26.10.9", true],
    ["27.1.0", "26.12.30", true],
    ["26.10.3", "26.10.3", false],
    ["26.10.2", "26.10.3", false],
    ["staging", "26.10.3", false],
  ])("%s newer than %s: %s", (candidate, current, expected) => {
    expect(isNewerVersion(candidate, current)).toBe(expected);
  });
});
