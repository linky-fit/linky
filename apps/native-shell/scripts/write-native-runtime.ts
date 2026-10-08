// Stamps the web build with a fingerprint of the native code it ships in.
// A live update reaches only shells whose fingerprint matches its own.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const shellDir = path.resolve(import.meta.dirname, "..");
const outputFile = path.resolve(
  shellDir,
  "../web-app/dist/native-runtime.json",
);

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  version?: string;
}

const readPackageManifest = (file: string): PackageManifest =>
  JSON.parse(readFileSync(file, "utf8"));

const nativeSources = execFileSync(
  "git",
  ["ls-files", "-z", "--", "android", "ios", "capacitor.config.ts"],
  { cwd: shellDir, encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean)
  .sort();

const { dependencies = {}, devDependencies = {} } = readPackageManifest(
  path.join(shellDir, "package.json"),
);
const nativePackages = [
  ...Object.keys(dependencies),
  ...Object.keys(devDependencies).filter((name) =>
    name.startsWith("@capacitor/"),
  ),
].sort();

const hash = createHash("sha256");
for (const file of nativeSources) {
  hash.update(`${file}\0`).update(readFileSync(path.join(shellDir, file)));
}
for (const name of nativePackages) {
  const manifestFile = fileURLToPath(
    import.meta.resolve(`${name}/package.json`),
  );
  hash.update(`${name}@${readPackageManifest(manifestFile).version}\0`);
}

const runtime = hash.digest("hex").slice(0, 16);
writeFileSync(outputFile, `${JSON.stringify({ runtime })}\n`);
console.log(`native runtime ${runtime} -> ${outputFile}`);
