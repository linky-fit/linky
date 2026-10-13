import { getUnknownErrorMessage } from "../utils/unknown";
import { asNonEmptyString } from "../utils/validation";
import type { SecretsPort } from "./ports";

/** The expo-secure-store calls the secrets port needs, with its options already bound. */
export interface SecureStoreLike {
  readonly getItemAsync: (key: string) => Promise<string | null>;
}

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
