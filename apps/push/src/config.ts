import { DEFAULT_NOSTR_RELAYS } from "@linky/linkstr";
import { resolve } from "node:path";

export const CATCH_UP_LOOKBACK_SECONDS = 3 * 24 * 60 * 60;
export const SEEN_EVENT_RETENTION_MARGIN_MS = 6 * 60 * 60 * 1000;

export interface PushServiceConfig {
  port: number;
  storagePath: string;
  buildCommitSha: string;
  vapidSubject: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  firebaseServiceAccountJson: string | null;
  defaultRelays: string[];
  corsOrigins: string[];
  challengeTtlMs: number;
  proofMaxAgeSeconds: number;
  maxPubkeysPerSubscription: number;
  maxSubscriptionsPerPubkey: number;
  authRateLimitMax: number;
  authRateLimitWindowMs: number;
  subscribeRateLimitMax: number;
  subscribeRateLimitWindowMs: number;
  unsubscribeRateLimitMax: number;
  unsubscribeRateLimitWindowMs: number;
}

class ConfigError extends Error {}

function readOptionalEnvString(
  env: Record<string, string | undefined>,
  key: string,
): string | null {
  const value = env[key];
  if (value === undefined) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readEnvString(
  env: Record<string, string | undefined>,
  key: string,
  fallback?: string,
): string {
  const value = env[key] ?? fallback;
  if (value === undefined || value.trim().length === 0) {
    throw new ConfigError(`${key} is required`);
  }
  return value;
}

function readEnvInteger(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (raw === undefined) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`${key} must be a positive integer`);
  }
  return value;
}

function readBuildCommitSha(env: Record<string, string | undefined>): string {
  const raw = env.BUILD_COMMIT_SHA?.trim();
  if (!raw) {
    return "unknown";
  }

  const normalized = raw.toLowerCase();
  const shortSha = normalized.slice(0, 12);
  return /^[a-f0-9]+$/.test(shortSha) ? shortSha : "unknown";
}

function readListEnv(
  env: Record<string, string | undefined>,
  key: string,
  fallback: string,
): string[] {
  const raw = env[key];
  const source = raw && raw.trim().length > 0 ? raw : fallback;
  const values = source
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (values.length === 0) {
    throw new ConfigError(`${key} must contain at least one value`);
  }

  return values;
}

function readRelayList(env: Record<string, string | undefined>): string[] {
  const relays = readListEnv(
    env,
    "PUSH_DEFAULT_RELAYS",
    DEFAULT_NOSTR_RELAYS.join(","),
  );
  return [...new Set(relays.map(normalizeRelayUrl))];
}

function readCorsOrigins(env: Record<string, string | undefined>): string[] {
  const values = readListEnv(env, "PUSH_CORS_ORIGIN", "*");
  if (values.includes("*")) {
    return ["*"];
  }
  return [...new Set(values.map(normalizeCorsOrigin))];
}

function normalizeCorsOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new ConfigError(`PUSH_CORS_ORIGIN contains invalid origin ${value}`);
  }
}

function normalizeRelayUrl(value: string): string {
  const candidate = value.includes("://") ? value : `wss://${value}`;
  const parsed = new URL(candidate);

  if (parsed.protocol === "http:") {
    parsed.protocol = "ws:";
  } else if (parsed.protocol === "https:") {
    parsed.protocol = "wss:";
  } else if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new ConfigError(
      `PUSH_DEFAULT_RELAYS contains unsupported protocol in ${value}`,
    );
  }

  parsed.pathname = parsed.pathname.replace(/\/+/g, "/");
  if (parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  if (
    (parsed.protocol === "ws:" && parsed.port === "80") ||
    (parsed.protocol === "wss:" && parsed.port === "443")
  ) {
    parsed.port = "";
  }

  parsed.searchParams.sort();
  parsed.hash = "";

  return parsed.toString();
}

export function loadConfig(
  env: Record<string, string | undefined>,
): PushServiceConfig {
  return {
    port: readEnvInteger(env, "PUSH_PORT", 8787),
    storagePath: resolve(
      readEnvString(env, "PUSH_STORAGE_PATH", "./data/linky-push.sqlite"),
    ),
    buildCommitSha: readBuildCommitSha(env),
    vapidSubject: readEnvString(env, "PUSH_VAPID_SUBJECT"),
    vapidPublicKey: readEnvString(env, "PUSH_VAPID_PUBLIC_KEY"),
    vapidPrivateKey: readEnvString(env, "PUSH_VAPID_PRIVATE_KEY"),
    firebaseServiceAccountJson: readOptionalEnvString(
      env,
      "PUSH_FIREBASE_SERVICE_ACCOUNT_JSON",
    ),
    defaultRelays: readRelayList(env),
    corsOrigins: readCorsOrigins(env),
    challengeTtlMs: readEnvInteger(env, "PUSH_CHALLENGE_TTL_MS", 5 * 60 * 1000),
    proofMaxAgeSeconds: readEnvInteger(env, "PUSH_PROOF_MAX_AGE_SECONDS", 300),
    maxPubkeysPerSubscription: readEnvInteger(
      env,
      "PUSH_MAX_PUBKEYS_PER_SUBSCRIPTION",
      8,
    ),
    maxSubscriptionsPerPubkey: readEnvInteger(
      env,
      "PUSH_MAX_SUBSCRIPTIONS_PER_PUBKEY",
      16,
    ),
    authRateLimitMax: readEnvInteger(env, "PUSH_RATE_LIMIT_AUTH_MAX", 30),
    authRateLimitWindowMs: readEnvInteger(
      env,
      "PUSH_RATE_LIMIT_AUTH_WINDOW_MS",
      60 * 1000,
    ),
    subscribeRateLimitMax: readEnvInteger(
      env,
      "PUSH_RATE_LIMIT_SUBSCRIBE_MAX",
      20,
    ),
    subscribeRateLimitWindowMs: readEnvInteger(
      env,
      "PUSH_RATE_LIMIT_SUBSCRIBE_WINDOW_MS",
      60 * 1000,
    ),
    unsubscribeRateLimitMax: readEnvInteger(
      env,
      "PUSH_RATE_LIMIT_UNSUBSCRIBE_MAX",
      20,
    ),
    unsubscribeRateLimitWindowMs: readEnvInteger(
      env,
      "PUSH_RATE_LIMIT_UNSUBSCRIBE_WINDOW_MS",
      60 * 1000,
    ),
  };
}
