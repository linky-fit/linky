import { deferPwaUpdateWhile } from "../utils/pwaUpdate";
import { localStorageKv, safeLocalStorageGet } from "../utils/storage";
import { getUnknownErrorMessage } from "../utils/unknown";
import { asNonEmptyString } from "../utils/validation";
import type { PlatformPorts, SecretRead } from "./ports";
import { isNativePlatform } from "./runtime";
import { readNativeSecret } from "./secretStorage";

// Undefined: the shell has no native store, so the localStorage copy is the secret.
const toSecretRead = (value: string | null | undefined): SecretRead => {
  const secret = asNonEmptyString(value);
  return secret === null
    ? { _tag: "Missing" }
    : { _tag: "Found", value: secret };
};

const readSecret = async (key: string): Promise<SecretRead> => {
  if (!isNativePlatform()) return toSecretRead(safeLocalStorageGet(key));
  try {
    return toSecretRead(await readNativeSecret(key));
  } catch (error) {
    return {
      _tag: "Unavailable",
      cause: getUnknownErrorMessage(error, "native secret read failed"),
    };
  }
};

const parseEvoluRelayUrls = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.startsWith("ws://") || url.startsWith("wss://"));

export const makeWebPlatformPorts = (): PlatformPorts => ({
  kv: localStorageKv,
  secrets: { read: readSecret },
  config: {
    evoluRelayDefaults: parseEvoluRelayUrls(
      import.meta.env.VITE_EVOLU_SERVER_URLS,
    ),
    isE2e: import.meta.env.VITE_E2E === "1",
  },
  lifecycle: {
    reload: () => globalThis.location.reload(),
    deferUpdateWhile: deferPwaUpdateWhile,
  },
});
