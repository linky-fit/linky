import { readField } from "../../utils/unknown";
import { asNonEmptyString } from "../../utils/validation";
interface QrCameraConstraintCandidate {
  constraints: MediaStreamConstraints;
  strategy: "device-exact" | "rear-exact" | "rear-ideal" | "any-camera";
}

interface QrCameraConstraintSet extends MediaTrackConstraintSet {
  focusMode?: string;
}

interface QrCameraTrack {
  applyConstraints(constraints?: MediaTrackConstraints): Promise<void>;
  getCapabilities(): unknown;
  getSettings(): unknown;
  readonly label: string;
}

const IDEAL_QR_WIDTH = 1280;
const IDEAL_QR_HEIGHT = 720;

const videoResolution = {
  height: { ideal: IDEAL_QR_HEIGHT },
  width: { ideal: IDEAL_QR_WIDTH },
};

export const buildQrCameraConstraintCandidates = (
  preferredDeviceId: string | null,
): readonly QrCameraConstraintCandidate[] => {
  const candidates: QrCameraConstraintCandidate[] = [];

  if (preferredDeviceId) {
    candidates.push({
      constraints: {
        audio: false,
        video: {
          ...videoResolution,
          deviceId: { exact: preferredDeviceId },
        },
      },
      strategy: "device-exact",
    });
  }

  candidates.push(
    {
      constraints: {
        audio: false,
        video: {
          ...videoResolution,
          facingMode: { exact: "environment" },
        },
      },
      strategy: "rear-exact",
    },
    {
      constraints: {
        audio: false,
        video: {
          ...videoResolution,
          facingMode: { ideal: "environment" },
        },
      },
      strategy: "rear-ideal",
    },
    {
      constraints: {
        audio: false,
        video: videoResolution,
      },
      strategy: "any-camera",
    },
  );

  return candidates;
};

const readString = (source: unknown, key: string): string | null =>
  asNonEmptyString(readField(source, key));

const readNumber = (source: unknown, key: string): number | null => {
  const value = readField(source, key);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

export const readSupportedCameraFocusModes = (
  capabilities: unknown,
): readonly string[] => {
  if (typeof capabilities !== "object" || capabilities === null) return [];
  const focusModes = Reflect.get(capabilities, "focusMode");
  if (!Array.isArray(focusModes)) return [];
  return focusModes.filter(
    (focusMode: unknown): focusMode is string => typeof focusMode === "string",
  );
};

export const configureQrCameraTrack = async (
  track: QrCameraTrack,
): Promise<Record<string, unknown>> => {
  let capabilities: unknown = null;
  try {
    capabilities = track.getCapabilities();
  } catch {
    // Older WebViews can expose getCapabilities() but still throw when called.
  }

  const supportedFocusModes = readSupportedCameraFocusModes(capabilities);
  let continuousFocusRequested = false;
  if (supportedFocusModes.includes("continuous")) {
    const focusConstraint: QrCameraConstraintSet = {
      focusMode: "continuous",
    };
    try {
      await track.applyConstraints({ advanced: [focusConstraint] });
      continuousFocusRequested = true;
    } catch {
      // Camera capability reporting is inconsistent across mobile browsers.
    }
  }

  let settings: unknown = null;
  try {
    settings = track.getSettings();
  } catch {
    // Keep scanning even when diagnostic settings are unavailable.
  }

  return {
    continuousFocusRequested,
    deviceId: readString(settings, "deviceId"),
    facingMode: readString(settings, "facingMode"),
    focusMode: readString(settings, "focusMode"),
    frameRate: readNumber(settings, "frameRate"),
    height: readNumber(settings, "height"),
    label: track.label || null,
    supportedFocusModes,
    width: readNumber(settings, "width"),
  };
};
