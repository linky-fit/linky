import { deferPwaUpdateWhile } from "../utils/pwaUpdate";
import { localStorageKv, safeLocalStorageGet } from "../utils/storage";
import { getUnknownErrorMessage } from "../utils/unknown";
import { asNonEmptyString } from "../utils/validation";
import { parseEvoluRelayUrls } from "./evoluRelayUrls";
import type { PlatformPorts, SecretRead } from "./ports";
import { isNativePlatform } from "./runtime";
import { readNativeSecret } from "./secretStorage";
import { envEvoluServerUrls, isDevBuild, isE2eBuild } from "./buildEnv";
import { isOnline } from "./appEvents";
import { reloadApp } from "./reload";

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

export const makeWebPlatformPorts = (): PlatformPorts => ({
  kv: localStorageKv,
  secrets: { read: readSecret },
  config: {
    evoluRelayDefaults: parseEvoluRelayUrls(envEvoluServerUrls),
    isE2e: isE2eBuild,
    isDev: isDevBuild,
  },
  lifecycle: {
    reload: reloadApp,
    deferUpdateWhile: deferPwaUpdateWhile,
    isOnline,
  },
});
