import { CameraPreview } from "@linky-fit/ui";
import type { Ref } from "react";

interface QrCameraProps {
  videoRef: Ref<HTMLVideoElement>;
}

/** The scanner's live picture; the scan loop reads its frames from `videoRef`. */
export function QrCamera({ videoRef }: QrCameraProps) {
  return <CameraPreview videoRef={videoRef} />;
}
