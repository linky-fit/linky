import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const isUnknownRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === "object";
};

/** The app's release version, shown in the app and sent with telemetry. */
export const appVersion = ((): string => {
  try {
    const raw = readFileSync(
      path.join(import.meta.dirname, "../package.json"),
      "utf8",
    );
    const pkg = JSON.parse(raw);
    if (!isUnknownRecord(pkg)) return "0.0.0";
    const version = pkg.version;
    return typeof version === "string" && version.trim()
      ? version.trim()
      : "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

const normalizeShortCommitSha = (value: string | undefined): string => {
  const trimmed = String(value ?? "").trim();
  return /^[0-9a-f]{7,40}$/i.test(trimmed) ? trimmed.slice(0, 7) : "";
};

/** Short sha of the built commit, or "" when neither CI env nor git knows it. */
export const appCommitSha = ((): string => {
  const envSha = normalizeShortCommitSha(
    process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.VITE_VERCEL_GIT_COMMIT_SHA ??
      process.env.GIT_COMMIT_SHA,
  );
  if (envSha) return envSha;

  try {
    return normalizeShortCommitSha(
      execSync("git rev-parse --short=7 HEAD", {
        cwd: import.meta.dirname,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString("utf8"),
    );
  } catch {
    return "";
  }
})();
