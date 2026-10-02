import { normalizeIp } from "./requestSecurity";

export interface BridgeConfig {
  port: number;
  /** Origin and optional base path POS terminals reach, without a trailing slash. */
  publicUrl: string;
  buildCommitSha: string;
  trustedProxyIps: string[];
  requestTimeoutMs: number;
  authTimeoutMs: number;
  maxSessionMs: number;
  sessionWaitMs: number;
  maxWaitersPerCard: number;
  maxWaiters: number;
  ipRateLimitMax: number;
  cardRateLimitMax: number;
  rateLimitWindowMs: number;
  /**
   * `redacted` prints one shortened line per message between POS, bridge and
   * card; `raw` also prints every HTTP request and WebSocket frame verbatim,
   * k1 included, so it is for local debugging only.
   */
  debug: DebugMode;
}

export type DebugMode = "off" | "redacted" | "raw";

class ConfigError extends Error {}

function readEnvInteger(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`${key} must be a positive integer`);
  }
  return value;
}

function readPublicUrl(env: Record<string, string | undefined>): string {
  const raw = env.BOLT_CARD_BRIDGE_PUBLIC_URL?.trim();
  if (!raw) throw new ConfigError("BOLT_CARD_BRIDGE_PUBLIC_URL is required");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError("BOLT_CARD_BRIDGE_PUBLIC_URL must be a URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ConfigError("BOLT_CARD_BRIDGE_PUBLIC_URL must be http(s)");
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

function readDebugMode(env: Record<string, string | undefined>): DebugMode {
  const value = env.BOLT_CARD_BRIDGE_DEBUG?.trim().toLowerCase() ?? "";
  if (value === "" || value === "0" || value === "false") return "off";
  if (value === "1" || value === "true") return "redacted";
  if (value === "raw") return "raw";
  throw new ConfigError("BOLT_CARD_BRIDGE_DEBUG must be 0, 1 or raw");
}

function readBuildCommitSha(env: Record<string, string | undefined>): string {
  const shortSha = (env.BUILD_COMMIT_SHA?.trim() ?? "")
    .toLowerCase()
    .slice(0, 12);
  return /^[a-f0-9]+$/.test(shortSha) ? shortSha : "unknown";
}

export function loadConfig(
  env: Record<string, string | undefined>,
): BridgeConfig {
  return {
    port: readEnvInteger(env, "BOLT_CARD_BRIDGE_PORT", 8789),
    publicUrl: readPublicUrl(env),
    buildCommitSha: readBuildCommitSha(env),
    trustedProxyIps: (env.BOLT_CARD_BRIDGE_TRUSTED_PROXY_IPS ?? "")
      .split(",")
      .map((ip) => ip.trim())
      .filter(Boolean)
      .map(normalizeIp),
    requestTimeoutMs: readEnvInteger(
      env,
      "BOLT_CARD_BRIDGE_REQUEST_TIMEOUT_MS",
      5_000,
    ),
    authTimeoutMs: readEnvInteger(
      env,
      "BOLT_CARD_BRIDGE_AUTH_TIMEOUT_MS",
      10_000,
    ),
    maxSessionMs: readEnvInteger(
      env,
      "BOLT_CARD_BRIDGE_MAX_SESSION_MS",
      10 * 60 * 1000,
    ),
    sessionWaitMs: readEnvInteger(
      env,
      "BOLT_CARD_BRIDGE_SESSION_WAIT_MS",
      3_000,
    ),
    maxWaitersPerCard: readEnvInteger(
      env,
      "BOLT_CARD_BRIDGE_MAX_WAITERS_PER_CARD",
      4,
    ),
    maxWaiters: readEnvInteger(env, "BOLT_CARD_BRIDGE_MAX_WAITERS", 1_000),
    ipRateLimitMax: readEnvInteger(
      env,
      "BOLT_CARD_BRIDGE_RATE_LIMIT_IP_MAX",
      120,
    ),
    cardRateLimitMax: readEnvInteger(
      env,
      "BOLT_CARD_BRIDGE_RATE_LIMIT_CARD_MAX",
      30,
    ),
    rateLimitWindowMs: readEnvInteger(
      env,
      "BOLT_CARD_BRIDGE_RATE_LIMIT_WINDOW_MS",
      60 * 1000,
    ),
    debug: readDebugMode(env),
  };
}
