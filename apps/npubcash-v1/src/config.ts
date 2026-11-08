import { hexToBytes } from "@noble/hashes/utils.js";

export interface ServiceConfig {
  port: number;
  databaseUrl: string;
  /** Derives every output this service mints; back it up like a wallet seed. */
  seed: Uint8Array;
  /** The fork's `JWT_SECRET`, so payment tokens the fork issued still verify. */
  jwtSecret: string;
  /** The fork's `MINTURL`: info fallback, default mint of new names, and the mint fees are paid on. */
  defaultMintUrl: string;
  /** Owns the username fee claims. */
  operatorPubkey: string;
  workerIntervalMs: number;
  buildCommitSha: string;
}

const HEX_PUBKEY = /^[0-9a-f]{64}$/;
const HEX_SEED = /^(?:[0-9a-f]{2}){32,}$/;

function required(env: Record<string, string | undefined>, key: string) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function matching(
  env: Record<string, string | undefined>,
  key: string,
  pattern: RegExp,
  description: string,
) {
  const value = required(env, key).toLowerCase();
  if (!pattern.test(value)) throw new Error(`${key} must be ${description}`);
  return value;
}

function positiveInteger(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
) {
  const raw = env[key];
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

function mintUrl(env: Record<string, string | undefined>, key: string) {
  const value = required(env, key);
  if (!URL.canParse(value)) throw new Error(`${key} must be a URL`);
  return value;
}

export function loadConfig(
  env: Record<string, string | undefined>,
): ServiceConfig {
  return {
    port: positiveInteger(env, "NPUBCASH_V1_PORT", 8788),
    databaseUrl: required(env, "NPUBCASH_V1_DATABASE_URL"),
    seed: hexToBytes(
      matching(env, "NPUBCASH_V1_SEED", HEX_SEED, "at least 32 bytes of hex"),
    ),
    jwtSecret: required(env, "NPUBCASH_V1_JWT_SECRET"),
    defaultMintUrl: mintUrl(env, "NPUBCASH_V1_MINT_URL"),
    operatorPubkey: matching(
      env,
      "NPUBCASH_V1_OPERATOR_PUBKEY",
      HEX_PUBKEY,
      "a hex pubkey",
    ),
    workerIntervalMs: positiveInteger(
      env,
      "NPUBCASH_V1_WORKER_INTERVAL_MS",
      5000,
    ),
    buildCommitSha: env.BUILD_COMMIT_SHA?.trim().slice(0, 12) || "unknown",
  };
}
