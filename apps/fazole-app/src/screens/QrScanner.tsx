import { CameraPreview, MediaFrame, Notice } from "@linky-fit/ui";
import { useEffect, useRef, useState } from "react";
import { copy } from "../copy";
import { startQrScanner } from "../platform/qrScanner";

/** The rear camera, reading QR codes until `onScan` accepts one. */
export function QrScanner({
  onScan,
}: {
  /** Returns whether the text was what the scanner was looking for. */
  readonly onScan: (text: string) => boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    onScanRef.current = onScan;
  });
  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    startQrScanner(video, (text) => onScanRef.current(text)).then(
      (stopScanner) => {
        if (cancelled) stopScanner();
        else stop = stopScanner;
      },
      () => {
        if (!cancelled) setUnavailable(true);
      },
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  return unavailable ? (
    <Notice tone="warning" title={copy.withdraw.scannerUnavailable} />
  ) : (
    <MediaFrame accessibilityLabel={copy.withdraw.scanner} aspectRatio={1}>
      <CameraPreview videoRef={videoRef} />
    </MediaFrame>
  );
}
