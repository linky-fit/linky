import { requiresDeviceMotionPermission } from "../../../platform/deviceMotion";
import {
  SEEN_RECEIPTS_ENABLED_AT_SEC_STORAGE_KEY,
  SHOW_PROFILE_QR_ON_TILT_STORAGE_KEY,
} from "../../../utils/constants";
import {
  getInitialSeenReceiptsEnabledAtSec,
  getInitialShowProfileQrOnTiltEnabled,
} from "../../../utils/storage";
import { Atom } from "effect/reactivity";
import { kvSeededAtom } from "../platform";

/**
 * When seen receipts were turned on, or null while they are off; only
 * messages newer than it are ever reported as seen.
 */
export const seenReceiptsEnabledAtSecAtom = kvSeededAtom(
  getInitialSeenReceiptsEnabledAtSec,
  // "0" (not key removal) persists the off state: an absent key means
  // "never decided" and re-enables by default on the next launch.
  (kv, enabledAtSec) =>
    kv.setItem(
      SEEN_RECEIPTS_ENABLED_AT_SEC_STORAGE_KEY,
      enabledAtSec === null ? "0" : String(enabledAtSec),
    ),
  { persistSeed: true },
);

/** Flipping the phone top-down shows the profile card; off until motion access is granted. */
export const showProfileQrOnTiltAtom = kvSeededAtom(
  (kv) =>
    !requiresDeviceMotionPermission() &&
    getInitialShowProfileQrOnTiltEnabled(kv),
  (kv, enabled) =>
    kv.setItem(SHOW_PROFILE_QR_ON_TILT_STORAGE_KEY, enabled ? "1" : "0"),
  { persistSeed: true },
);

/** The motion permission prompt is open; a second tap meanwhile is ignored. */
export const motionPermissionPendingAtom = Atom.keepAlive(Atom.make(false));
