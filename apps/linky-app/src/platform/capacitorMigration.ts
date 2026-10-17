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
import {
  carryLegacySettings,
  parseLegacyWebStorage,
  type CarriedSettings,
} from "./legacyWebStorage";
import type { KeyValuePort, SecretsPort } from "./ports";
import type { WritableSecureStore } from "./secureStoreSecrets";

/** What the Android Capacitor app left in the app's data directory. */
export interface CapacitorStores {
  /** Whether the encrypted preferences `linky.secure.secrets` hold any entry, readable or not. */
  readonly hasLegacySecrets: () => boolean;
  /** Rejects when the entries can't be decrypted. */
  readonly readLegacySecrets: () => Promise<Readonly<Record<string, string>>>;
  /** The WebView's localStorage as JSON, null when the app has none; rejects when it can't be read. */
  readonly readLegacyWebStorage: () => Promise<string | null>;
  /** Deletes the encrypted preferences and the WebView's storage. */
  readonly clearLegacyStores: () => Promise<void>;
}

const MIGRATED_KEY = "linky.legacySecrets.migrated";

const SECRET_KEYS = [
  NOSTR_NSEC_STORAGE_KEY,
  NOSTR_ATTACHED_NSEC_STORAGE_KEY,
  NOSTR_SLIP39_SEED_STORAGE_KEY,
  CASHU_BIP85_MNEMONIC_STORAGE_KEY,
  INITIAL_MNEMONIC_STORAGE_KEY,
];

type Secrets = Readonly<Record<string, string>>;

type SourceRead<A> =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Read"; readonly value: A }
  | { readonly _tag: "Failed"; readonly cause: string };

const absent: SourceRead<never> = { _tag: "Absent" };
const failedWith =
  (fallback: string) =>
  (error: unknown): SourceRead<never> => ({
    _tag: "Failed",
    cause: getUnknownErrorMessage(error, fallback),
  });

const readEncryptedSecrets = (
  stores: CapacitorStores,
): Promise<SourceRead<Secrets>> =>
  stores.hasLegacySecrets()
    ? stores
        .readLegacySecrets()
        .then(
          (value): SourceRead<Secrets> => ({ _tag: "Read", value }),
          failedWith("read failed"),
        )
    : Promise.resolve(absent);

const readWebStorage = (
  stores: CapacitorStores,
): Promise<SourceRead<Secrets>> =>
  stores.readLegacyWebStorage().then((dump): SourceRead<Secrets> => {
    if (dump === null) return absent;
    const value = parseLegacyWebStorage(dump);
    return value === null
      ? { _tag: "Failed", cause: "not a string map" }
      : { _tag: "Read", value };
  }, failedWith("WebView read failed"));

const pickSecrets = (source: SourceRead<Secrets>): Secrets => {
  if (source._tag !== "Read") return {};
  const picked: Record<string, string> = {};
  for (const key of SECRET_KEYS) {
    const value = asNonEmptyString(source.value[key]);
    if (value !== null) picked[key] = value;
  }
  return picked;
};

type SecretsSource = "encrypted" | "webStorage" | "none";

/**
 * The encrypted preferences win. The WebView's plaintext copy only stands
 * in when they hold no nsec, and only fills their gaps for the same nsec.
 */
const chooseSecrets = (
  encrypted: Secrets,
  plaintext: Secrets,
): { readonly values: Secrets; readonly source: SecretsSource } => {
  const nsec = encrypted[NOSTR_NSEC_STORAGE_KEY];
  if (nsec === undefined)
    return {
      values: plaintext,
      source: plaintext[NOSTR_NSEC_STORAGE_KEY] ? "webStorage" : "none",
    };
  return {
    values:
      plaintext[NOSTR_NSEC_STORAGE_KEY] === nsec
        ? { ...plaintext, ...encrypted }
        : encrypted,
    source: "encrypted",
  };
};

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

/** Ends the migration: the old stores go, so a later boot never copies them back over a logout. */
const finish = async (
  stores: CapacitorStores,
  kv: KeyValuePort,
): Promise<string | null> => {
  const clearFailure = await stores.clearLegacyStores().then(
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
 * Moves an Android Capacitor install into the Expo app, once: device
 * settings and cashu state from the WebView's localStorage into the native
 * key-value store, the identity secrets into the secure store, each only
 * into keys the target doesn't hold. A secure store already holding another
 * identity takes no secrets. The old stores are deleted once everything
 * arrived. Resolves the secret keys the old stores may hold that didn't
 * arrive, which boot must treat as unreadable; the next boot tries again.
 */
export const migrateCapacitorApp = async ({
  stores,
  store,
  kv,
}: {
  readonly stores: CapacitorStores | null;
  readonly store: WritableSecureStore;
  readonly kv: KeyValuePort;
}): Promise<ReadonlySet<string>> => {
  if (kv.getItem(MIGRATED_KEY) === "1") return new Set();
  if (stores === null) {
    kv.setItem(MIGRATED_KEY, "1");
    return new Set();
  }
  const [encrypted, web] = await Promise.all([
    readEncryptedSecrets(stores),
    readWebStorage(stores),
  ]);
  if (encrypted._tag === "Absent" && web._tag === "Absent") {
    kv.setItem(MIGRATED_KEY, "1");
    return new Set();
  }

  const settings: CarriedSettings | null =
    web._tag === "Read" ? carryLegacySettings(web.value, kv) : null;
  const { values, source } = chooseSecrets(
    pickSecrets(encrypted),
    pickSecrets(web),
  );
  const legacyNsec = values[NOSTR_NSEC_STORAGE_KEY] ?? null;
  const targetNsec = await readTarget(store, NOSTR_NSEC_STORAGE_KEY);
  const sources = { encrypted: encrypted._tag, webStorage: web._tag };

  if (targetNsec && targetNsec !== legacyNsec) {
    const clearFailure = await finish(stores, kv);
    reportAppLog({
      tag: "secrets.legacyMigrationAbandoned",
      summary:
        "The secure store already holds an identity the Capacitor app's secrets don't match; dropped them",
      payload: { sources, settings, clearFailure },
    });
    return new Set();
  }
  const unreadable = [encrypted, web].flatMap((read) =>
    read._tag === "Failed" ? [read.cause] : [],
  );
  if (
    legacyNsec === null &&
    (encrypted._tag === "Read" || unreadable.length > 0)
  ) {
    const cause = unreadable.join("; ") || "holds no nsec";
    const unavailable = await missingKeys(store);
    reportAppLog({
      tag: "secrets.legacyMigrationFailed",
      summary: `The Capacitor app's secrets could not be read (${cause}); ${unavailable.size} keys count as unreadable until a boot reads them`,
      payload: { cause, sources, settings, unavailable: [...unavailable] },
    });
    return unavailable;
  }

  const entries = Object.entries(values);
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
  const clearFailure = failed.size === 0 ? await finish(stores, kv) : null;
  const counts = countOutcomes(outcomes);
  reportAppLog({
    tag: "secrets.legacyMigrated",
    summary: `Capacitor migration from ${source}: ${counts.copied} secrets copied, ${counts.alreadyPresent} already present, ${counts.kept} kept, ${counts.failed} failed; ${settings?.copied ?? 0} settings copied`,
    payload: {
      ...counts,
      source,
      sources,
      settings,
      failed: [...failed],
      clearFailure,
    },
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
