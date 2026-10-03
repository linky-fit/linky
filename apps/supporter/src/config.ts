import { parseMintUrl } from "@linky-fit/linkshu";
import type { MintUrl } from "@linky-fit/linkshu";
import { DEFAULT_NOSTR_RELAYS, RelayUrl } from "@linky-fit/linkstr";
import { SUPPORTER_ACCEPTED_MINTS } from "@linky-fit/supporter";
import { Schema } from "effect";
import { resolve } from "node:path";

type Env = Record<string, string | undefined>;

export interface SupporterConfig {
  readonly port: number;
  readonly storagePath: string;
  readonly buildCommitSha: string;
  readonly relays: ReadonlyArray<RelayUrl>;
  readonly allowInsecureLocalhostRelays: boolean;
  readonly acceptedMints: ReadonlyArray<MintUrl>;
}

export class ConfigError extends Error {}

const readList = (env: Env, key: string): ReadonlyArray<string> | null => {
  const values = (env[key] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return values.length > 0 ? values : null;
};

const readPort = (env: Env): number => {
  const raw = env.SUPPORTER_PORT;
  if (raw === undefined) return 8788;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535)
    throw new ConfigError("SUPPORTER_PORT must be a port number");
  return port;
};

const readBuildCommitSha = (env: Env): string => {
  const sha = env.BUILD_COMMIT_SHA?.trim().toLowerCase().slice(0, 12) ?? "";
  return /^[a-f0-9]+$/.test(sha) ? sha : "unknown";
};

const readRelays = (env: Env): ReadonlyArray<RelayUrl> => {
  const relays = readList(env, "SUPPORTER_RELAYS") ?? DEFAULT_NOSTR_RELAYS;
  return [
    ...new Set(
      relays.map((relay) => {
        if (!Schema.is(RelayUrl)(relay))
          throw new ConfigError(`SUPPORTER_RELAYS: not a relay url ${relay}`);
        return relay;
      }),
    ),
  ];
};

const readAcceptedMints = (env: Env): ReadonlyArray<MintUrl> =>
  (readList(env, "SUPPORTER_ACCEPTED_MINTS") ?? SUPPORTER_ACCEPTED_MINTS).map(
    (raw) => {
      const mint = parseMintUrl(raw);
      if (mint === null)
        throw new ConfigError(
          `SUPPORTER_ACCEPTED_MINTS: not a mint url ${raw}`,
        );
      return mint;
    },
  );

export const loadConfig = (env: Env): SupporterConfig => ({
  port: readPort(env),
  storagePath: resolve(
    env.SUPPORTER_STORAGE_PATH ?? "./data/linky-supporter.sqlite",
  ),
  buildCommitSha: readBuildCommitSha(env),
  relays: readRelays(env),
  allowInsecureLocalhostRelays:
    env.SUPPORTER_ALLOW_INSECURE_LOCALHOST_RELAYS === "1",
  acceptedMints: readAcceptedMints(env),
});

/** Kept out of `SupporterConfig` so the seed never travels with the config. */
export const readRecoverySeed = (env: Env): string => {
  const seed = env.SUPPORTER_RECOVERY_SEED?.trim();
  if (!seed) throw new ConfigError("SUPPORTER_RECOVERY_SEED is required");
  return seed;
};
