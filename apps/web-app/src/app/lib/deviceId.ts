import { DEVICE_ID_STORAGE_KEY } from "../../utils/constants";
import { safeLocalStorageGet, safeLocalStorageSet } from "../../utils/storage";
import { makeLocalId } from "../../utils/validation";

let sessionDeviceId: string | null = null;

/**
 * Stable id of this browser profile / app install. Falls back to a
 * per-session id when storage is unavailable, so callers always get one.
 */
export const getDeviceId = (): string => {
  const stored = safeLocalStorageGet(DEVICE_ID_STORAGE_KEY)?.trim();
  if (stored) return stored;
  sessionDeviceId ??= makeLocalId();
  safeLocalStorageSet(DEVICE_ID_STORAGE_KEY, sessionDeviceId);
  return sessionDeviceId;
};
