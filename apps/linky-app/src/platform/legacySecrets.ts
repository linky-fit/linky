import { markAwaitingFirstHydration } from "@linky-fit/linksync/evolu";
import { reportAppLog } from "../devtools/inspector/appLog";
import { INITIAL_MNEMONIC_STORAGE_KEY } from "../mnemonic";
import {
  CASHU_BIP85_MNEMONIC_STORAGE_KEY,
  NOSTR_ATTACHED_NSEC_STORAGE_KEY,
  NOSTR_NSEC_STORAGE_KEY,
  NOSTR_SLIP39_SEED_STORAGE_KEY,
} from "../utils/constants";
import { getUnknownErrorMessage } from "../utils/unknown";
import { asNonEmptyString } from "../utils/validation";
import { writeAppMnemonicState } from "./appMnemonicState";
import type { KeyValuePort, SecretsPort } from "./ports";
import type { WritableSecureStore } from "./secureStoreSecrets";

/** The Android Capacitor app's encrypted preferences `linky.secure.secrets`. */
export interface LegacySecretStore {
  /** Whether the store holds any entry, readable or not. */
  readonly hasLegacySecrets: () => boolean;
  /** Rejects when the entries can't be decrypted. */
  readonly readLegacySecrets: () => Promise<Readonly<Record<string, string>>>;
  readonly clearLegacySecrets: () => Promise<void>;
}

const MIGRATED_KEY = "linky.legacySecrets.migrated";

const SECRET_KEYS = [
  NOSTR_NSEC_STORAGE_KEY,
  NOSTR_ATTACHED_NSEC_STORAGE_KEY,
  NOSTR_SLIP39_SEED_STORAGE_KEY,
  CASHU_BIP85_MNEMONIC_STORAGE_KEY,
  INITIAL_MNEMONIC_STORAGE_KEY,
];

const noValues: Readonly<Record<string, string>> = {};

type KeyOutcome = "copied" | "alreadyPresent" | "kept" | "failed";

const readTarget = async (
  store: WritableSecureStore,
  key: string,
): Promise<string | null | undefined> =>
  store.getItemAsync(key).then(asNonEmptyString, () => undefined);

const copyKey = async (
  store: WritableSecureStore,
  key: string,
  value: string,
): Promise<KeyOutcome> => {
  const current = await readTarget(store, key);
  if (current === undefined) return "failed";
  if (current === value) return "alreadyPresent";
  if (current !== null) return "kept";
  try {
    await store.setItemAsync(key, value);
  } catch {
    return "failed";
  }
  return (await readTarget(store, key)) === value ? "copied" : "failed";
};

const countOutcomes = (outcomes: ReadonlyArray<KeyOutcome>) => {
  const counts: Record<KeyOutcome, number> = {
    copied: 0,
    alreadyPresent: 0,
    kept: 0,
    failed: 0,
  };
  for (const outcome of outcomes) counts[outcome] += 1;
  return counts;
};

/** Ends the migration: the old store goes, so a later boot never copies it back over a logout. */
const finish = async (
  legacy: LegacySecretStore,
  kv: KeyValuePort,
): Promise<string | null> => {
  const clearFailure = await legacy.clearLegacySecrets().then(
    () => null,
    (error: unknown) => getUnknownErrorMessage(error, "clear failed"),
  );
  kv.setItem(MIGRATED_KEY, "1");
  return clearFailure;
};

const missingKeys = async (
  store: WritableSecureStore,
): Promise<ReadonlySet<string>> => {
  const values = await Promise.all(
    SECRET_KEYS.map((key) => readTarget(store, key)),
  );
  return new Set(SECRET_KEYS.filter((_, index) => !values[index]));
};

/**
 * Moves the identity secrets of the Android Capacitor app into the secure
 * store, once, filling only keys the secure store doesn't hold. A store
 * already holding another identity takes nothing from it. Resolves the keys
 * the old store may hold that didn't arrive, which boot must treat as
 * unreadable; the next boot tries those again.
 */
export const migrateLegacySecrets = async ({
  legacy,
  store,
  kv,
}: {
  readonly legacy: LegacySecretStore | null;
  readonly store: WritableSecureStore;
  readonly kv: KeyValuePort;
}): Promise<ReadonlySet<string>> => {
  if (kv.getItem(MIGRATED_KEY) === "1") return new Set();
  if (legacy === null || !legacy.hasLegacySecrets()) {
    kv.setItem(MIGRATED_KEY, "1");
    return new Set();
  }

  const { values, failure } = await legacy.readLegacySecrets().then(
    (read) => ({ values: read, failure: null }),
    (error: unknown) => ({
      values: noValues,
      failure: getUnknownErrorMessage(error, "read failed"),
    }),
  );
  const legacyNsec = asNonEmptyString(values[NOSTR_NSEC_STORAGE_KEY]);
  const targetNsec = await readTarget(store, NOSTR_NSEC_STORAGE_KEY);

  if (targetNsec && targetNsec !== legacyNsec) {
    const cause =
      failure ?? (legacyNsec === null ? "holds no nsec" : "another identity");
    const clearFailure = await finish(legacy, kv);
    reportAppLog({
      tag: "secrets.legacyMigrationAbandoned",
      summary: `The secure store already holds an identity and the Capacitor app's secrets don't match it (${cause}); dropped them`,
      payload: { cause, clearFailure },
    });
    return new Set();
  }
  if (legacyNsec === null) {
    const cause = failure ?? "holds no nsec";
    const unavailable = await missingKeys(store);
    reportAppLog({
      tag: "secrets.legacyMigrationFailed",
      summary: `The Capacitor app's secrets could not be read (${cause}); ${unavailable.size} keys count as unreadable until a boot reads them`,
      payload: { cause, unavailable: [...unavailable] },
    });
    return unavailable;
  }

  const entries = SECRET_KEYS.flatMap((key) => {
    const value = asNonEmptyString(values[key]);
    return value === null ? [] : [[key, value] as const];
  });
  const outcomes = await Promise.all(
    entries.map(([key, value]) => copyKey(store, key, value)),
  );
  const failed = new Set(
    entries
      .filter((_, index) => outcomes[index] === "failed")
      .map(([key]) => key),
  );

  const adoptedAppMnemonic = entries.find(
    ([key], index) =>
      key === INITIAL_MNEMONIC_STORAGE_KEY && outcomes[index] === "copied",
  )?.[1];
  if (adoptedAppMnemonic) {
    writeAppMnemonicState(kv, "present");
    markAwaitingFirstHydration(kv, adoptedAppMnemonic);
  }
  const clearFailure = failed.size === 0 ? await finish(legacy, kv) : null;
  const counts = countOutcomes(outcomes);
  reportAppLog({
    tag: "secrets.legacyMigrated",
    summary: `Capacitor secrets migration: ${counts.copied} copied, ${counts.alreadyPresent} already present, ${counts.kept} kept, ${counts.failed} failed`,
    payload: { ...counts, failed: [...failed], clearFailure },
  });
  return failed;
};

/** Reads `keys` the secure store misses as unavailable instead of missing. */
export const withUnmigratedSecrets = (
  secrets: SecretsPort,
  keys: ReadonlySet<string>,
): SecretsPort => ({
  read: async (key) => {
    const read = await secrets.read(key);
    return read._tag === "Missing" && keys.has(key)
      ? { _tag: "Unavailable", cause: "not migrated from the Capacitor app" }
      : read;
  },
});
