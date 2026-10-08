// Packs the built web app into a live update for the native runtime it was
// stamped with: `live-update-<runtime>.zip` plus its signed manifest.
// Usage: bun scripts/publish-live-update.ts <release-tag> <output-dir>
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Schema } from "effect";
import { zipSync } from "fflate";
import {
  bundleSha256,
  LIVE_UPDATE_PUBLIC_KEY,
  liveUpdateAssetName,
  liveUpdatePublicKey,
  NativeRuntimeFile,
  signLiveUpdateManifest,
} from "../../web-app/src/platform/liveUpdateManifest.ts";

const [releaseTag, outputDir] = process.argv.slice(2);
const signingKey = process.env.LIVE_UPDATE_SIGNING_KEY?.trim();
if (!releaseTag || !outputDir || !signingKey) {
  throw new Error(
    "Usage: LIVE_UPDATE_SIGNING_KEY=<hex> bun scripts/publish-live-update.ts <release-tag> <output-dir>",
  );
}

if (liveUpdatePublicKey(signingKey) !== LIVE_UPDATE_PUBLIC_KEY) {
  throw new Error(
    "LIVE_UPDATE_SIGNING_KEY does not match LIVE_UPDATE_PUBLIC_KEY, so devices would reject this update",
  );
}

const repoDir = path.resolve(import.meta.dirname, "../../..");
const distDir = path.join(repoDir, "apps/web-app/dist");
const { runtime } = Schema.decodeUnknownSync(
  Schema.parseJson(NativeRuntimeFile),
)(readFileSync(path.join(distDir, "native-runtime.json"), "utf8"));
const { version } = Schema.decodeUnknownSync(
  Schema.parseJson(Schema.Struct({ version: Schema.NonEmptyString })),
)(readFileSync(path.join(repoDir, "package.json"), "utf8"));

const files = readdirSync(distDir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.join(entry.parentPath, entry.name));
const bundle = zipSync(
  Object.fromEntries(
    files.map((file) => [path.relative(distDir, file), readFileSync(file)]),
  ),
);

const zipName = liveUpdateAssetName(runtime, "zip");
const manifest = signLiveUpdateManifest(
  {
    runtime,
    version,
    url: `https://github.com/linky-fit/linky/releases/download/${releaseTag}/${zipName}`,
    sha256: bundleSha256(bundle),
  },
  signingKey,
);

mkdirSync(outputDir, { recursive: true });
writeFileSync(path.join(outputDir, zipName), bundle);
writeFileSync(
  path.join(outputDir, liveUpdateAssetName(runtime, "json")),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `live update ${version} for runtime ${runtime}: ${files.length} files`,
);
