import { RelayUrl, type Pubkey } from "@linky-fit/linkstr";
import { normalizeEvoluRelayUrl } from "@linky-fit/linksync/evolu";
import { BitcoinNetwork } from "@linky-fit/onchain-transfer";
import { Option, Schema } from "effect";
import * as fs from "node:fs";
import { resolveAppConfig, type AppConfig } from "../appConfig";
import { MAX_WATCHERS, parseWatchers } from "../domain/watchers";

export interface DaemonConfig {
  readonly recoverySeed: string;
  readonly dataDir: string;
  readonly extraWatchers: readonly Pubkey[];
  readonly appConfig: AppConfig;
}

const readTrimmed = (value: string | undefined): string => value?.trim() ?? "";

const parseCsv = (value: string): readonly string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const parseBoolean = (value: string | undefined): boolean => {
  const normalized = readTrimmed(value).toLowerCase();
  return normalized === "1" || normalized === "true";
};

const readRecoverySeed = (
  env: Readonly<Record<string, string | undefined>>,
  readFile: (filePath: string) => string,
): string => {
  const inline = readTrimmed(env.OPERATOR_RECOVERY_SEED);
  const filePath = readTrimmed(env.OPERATOR_RECOVERY_SEED_FILE);
  if (inline !== "" && filePath !== "") {
    throw new Error(
      "Set either OPERATOR_RECOVERY_SEED or OPERATOR_RECOVERY_SEED_FILE, not both.",
    );
  }
  if (filePath !== "") {
    const fromFile = readFile(filePath).trim();
    if (fromFile === "") {
      throw new Error(`OPERATOR_RECOVERY_SEED_FILE (${filePath}) is empty.`);
    }
    return fromFile;
  }
  if (inline === "") {
    throw new Error(
      "Missing recovery seed: set OPERATOR_RECOVERY_SEED or OPERATOR_RECOVERY_SEED_FILE.",
    );
  }
  return inline;
};

const validateNostrRelays = (raw: string): string | undefined => {
  if (raw === "") return undefined;
  const entries = parseCsv(raw);
  const invalid = entries.filter((entry) => !Schema.is(RelayUrl)(entry));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid OPERATOR_NOSTR_RELAYS entries: ${invalid.join(", ")}`,
    );
  }
  return entries.join(",");
};

const validateEvoluRelays = (raw: string): string | undefined => {
  if (raw === "") return undefined;
  const entries = parseCsv(raw);
  const invalid = entries.filter(
    (entry) => normalizeEvoluRelayUrl(entry) === null,
  );
  if (invalid.length > 0) {
    throw new Error(
      `Invalid OPERATOR_EVOLU_RELAYS entries: ${invalid.join(", ")}`,
    );
  }
  return entries.join(",");
};

const validateNetwork = (raw: string): BitcoinNetwork | undefined => {
  if (raw === "") return undefined;
  const decoded = Schema.decodeUnknownOption(BitcoinNetwork)(raw);
  if (Option.isNone(decoded)) {
    throw new Error(
      `Invalid OPERATOR_NETWORK "${raw}": expected mainnet, testnet, signet or regtest.`,
    );
  }
  return decoded.value;
};

const parseExtraWatchers = (raw: string): readonly Pubkey[] => {
  if (raw === "") return [];
  const parsed = parseWatchers(raw);
  if (parsed === null) {
    throw new Error(
      `Invalid OPERATOR_WATCHERS: expected up to ${MAX_WATCHERS} valid npubs.`,
    );
  }
  return parsed;
};

export const loadDaemonConfig = (
  env: Readonly<Record<string, string | undefined>>,
  readFile: (filePath: string) => string = (filePath) =>
    fs.readFileSync(filePath, "utf8"),
): DaemonConfig => {
  const recoverySeed = readRecoverySeed(env, readFile);
  const extraWatchers = parseExtraWatchers(readTrimmed(env.OPERATOR_WATCHERS));
  const dataDir = readTrimmed(env.OPERATOR_DATA_DIR) || "./data";
  const nostrRelays = validateNostrRelays(
    readTrimmed(env.OPERATOR_NOSTR_RELAYS),
  );
  const evoluRelays = validateEvoluRelays(
    readTrimmed(env.OPERATOR_EVOLU_RELAYS),
  );
  const network = validateNetwork(readTrimmed(env.OPERATOR_NETWORK));

  return {
    recoverySeed,
    dataDir,
    extraWatchers,
    appConfig: resolveAppConfig({
      nostrRelays,
      evoluRelays,
      mintUrl: env.OPERATOR_MINT_URL,
      allowInsecureLocalhostRelays: parseBoolean(
        env.OPERATOR_ALLOW_INSECURE_LOCALHOST_RELAYS,
      ),
      network,
      esploraUrl: env.OPERATOR_ESPLORA_URL,
      explorerUrl: env.OPERATOR_EXPLORER_URL,
    }),
  };
};
