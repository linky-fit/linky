import { getUnknownErrorMessage } from "../utils/unknown";
import { asNonEmptyString } from "../utils/validation";
import type { SecretsPort } from "./ports";

/** The expo-secure-store calls the secrets port needs, with its options already bound. */
export interface SecureStoreLike {
  readonly getItemAsync: (key: string) => Promise<string | null>;
}

/** The expo-secure-store calls a secret write needs. */
export interface WritableSecureStore extends SecureStoreLike {
  readonly setItemAsync: (key: string, value: string) => Promise<void>;
  readonly deleteItemAsync: (key: string) => Promise<void>;
}

/** The secure store refused to keep the secrets; nothing holds a plaintext copy. */
export class SecretsWriteFailed extends Error {
  readonly keys: ReadonlyArray<string>;
  constructor(keys: ReadonlyArray<string>) {
    super(`Secure storage refused ${keys.join(", ")}`);
    this.name = "SecretsWriteFailed";
    this.keys = keys;
  }
}

const storeValue = (
  store: WritableSecureStore,
  key: string,
  value: string | null,
): Promise<void> =>
  value === null ? store.deleteItemAsync(key) : store.setItemAsync(key, value);

/**
 * Writes the secrets to the secure store as one set (empty values remove
 * their key). When it refuses any of them, the keys get back the values
 * they held before, so boot never reads a mix of two identities, and the
 * write rejects with SecretsWriteFailed. A key whose old value could not be
 * read is left as the failed write left it.
 */
export const writeSecureSecretSet = async (
  store: WritableSecureStore,
  secrets: Readonly<Record<string, string>>,
): Promise<void> => {
  const entries = Object.entries(secrets).map(
    ([key, value]) => [key, asNonEmptyString(value)] as const,
  );
  const previous = await Promise.all(
    entries.map(([key]) =>
      store.getItemAsync(key).then(asNonEmptyString, () => undefined),
    ),
  );
  const writes = await Promise.allSettled(
    entries.map(([key, value]) => storeValue(store, key, value)),
  );
  const refused = entries.filter(
    (_, index) => writes[index]?.status === "rejected",
  );
  if (refused.length === 0) return;
  await Promise.allSettled(
    entries.map(([key], index) => {
      const old = previous[index];
      return old === undefined ? undefined : storeValue(store, key, old);
    }),
  );
  throw new SecretsWriteFailed(refused.map(([key]) => key));
};

/**
 * The native secrets port: the secure store is the only copy, so a failed
 * read is Unavailable (unknown), never Missing. Boot bounds a read that
 * never answers (`loadSession`).
 */
export const makeNativeSecretsPort = (store: SecureStoreLike): SecretsPort => ({
  read: async (key) => {
    try {
      const value = asNonEmptyString(await store.getItemAsync(key));
      return value === null ? { _tag: "Missing" } : { _tag: "Found", value };
    } catch (error) {
      return {
        _tag: "Unavailable",
        cause: getUnknownErrorMessage(error, "secure store read failed"),
      };
    }
  },
});
