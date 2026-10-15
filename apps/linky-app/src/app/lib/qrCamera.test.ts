import { describe, expect, it, vi } from "vitest";
import {
  buildQrCameraConstraintCandidates,
  configureQrCameraTrack,
  readSupportedCameraFocusModes,
} from "./qrCamera";

describe("QR camera selection", () => {
  it("tries a selected device before rear-camera and generic fallbacks", () => {
    expect(
      buildQrCameraConstraintCandidates("camera-2").map(
        (candidate) => candidate.strategy,
      ),
    ).toEqual(["device-exact", "rear-exact", "rear-ideal", "any-camera"]);
  });

  it("requires a rear camera before relaxing the web constraint", () => {
    const candidates = buildQrCameraConstraintCandidates(null);
    expect(candidates.map((candidate) => candidate.strategy)).toEqual([
      "rear-exact",
      "rear-ideal",
      "any-camera",
    ]);
    expect(candidates[0]?.constraints.video).toMatchObject({
      facingMode: { exact: "environment" },
      height: { ideal: 720 },
      width: { ideal: 1280 },
    });
  });

  it("requests continuous focus only when the camera reports support", async () => {
    const applyConstraints = vi.fn().mockResolvedValue(undefined);
    const track = {
      applyConstraints,
      getCapabilities: () => ({ focusMode: ["manual", "continuous"] }),
      getSettings: () => ({
        deviceId: "rear-wide",
        facingMode: "environment",
        focusMode: "continuous",
        height: 720,
        width: 1280,
      }),
      label: "Back Camera",
    };

    const details = await configureQrCameraTrack(track);

    expect(applyConstraints).toHaveBeenCalledWith({
      advanced: [{ focusMode: "continuous" }],
    });
    expect(details).toMatchObject({
      continuousFocusRequested: true,
      deviceId: "rear-wide",
      focusMode: "continuous",
    });
  });

  it("ignores malformed focus capability values", () => {
    expect(readSupportedCameraFocusModes({ focusMode: "continuous" })).toEqual(
      [],
    );
  });
});
