import { useEffect, useRef, useState } from "react";
import { CameraPreview } from "./camera-preview";
import { Notice } from "./feedback";
import { MediaFrame } from "./media";
import type { QrScannerProps } from "./qr-scanner";

const SCAN_INTERVAL_MS = 200;
// A pairing invite is a dense code; a phone screen held to a webcam needs the detail.
const MAX_DECODE_SIDE = 1280;

interface DetectedBarcode {
  readonly rawValue: string;
}
interface BarcodeDetectorLike {
  readonly detect: (
    source: HTMLVideoElement,
  ) => Promise<ReadonlyArray<DetectedBarcode>>;
}
const isDetector = (value: unknown): value is BarcodeDetectorLike =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "detect") === "function";

/** The browser's own decoder where it has one: faster and better on screens than jsQR. */
const nativeDetector = (): BarcodeDetectorLike | null => {
  const Detector: unknown = Reflect.get(globalThis, "BarcodeDetector");
  if (typeof Detector !== "function") return null;
  try {
    const detector: unknown = Reflect.construct(Detector, [
      { formats: ["qr_code"] },
    ]);
    return isDetector(detector) ? detector : null;
  } catch {
    return null;
  }
};

const cameraConstraints: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

/**
 * Plays the rear camera in `video` and decodes QR codes from it until
 * `onText` accepts one or the returned stop runs. Rejects when the camera is
 * unavailable or refused.
 */
const startQrScanner = async (
  video: HTMLVideoElement,
  onText: (text: string) => boolean,
  isCancelled: () => boolean,
): Promise<() => void> => {
  const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints);
  const { default: jsQR } = await import("jsqr");
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    for (const track of stream.getTracks()) track.stop();
    // A newer scan on the same element (StrictMode mounts twice) keeps its own stream.
    if (video.srcObject === stream) video.srcObject = null;
  };
  if (isCancelled()) {
    stop();
    return stop;
  }
  video.srcObject = stream;
  await video.play().catch(() => undefined);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const detector = nativeDetector();

  const decodeWithJsQr = (width: number, height: number): string | null => {
    if (!context) return null;
    const scale = Math.min(1, MAX_DECODE_SIDE / Math.max(width, height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, canvas.width, canvas.height)?.data.trim() ?? null;
  };

  const decode = async (): Promise<string | null> => {
    const { videoWidth: width, videoHeight: height } = video;
    if (width === 0 || height === 0) return null;
    if (detector !== null) {
      const found = await detector.detect(video).catch(() => []);
      const text = found[0]?.rawValue.trim();
      if (text) return text;
    }
    return decodeWithJsQr(width, height);
  };

  const scan = async () => {
    if (stopped) return;
    const text = await decode();
    if (stopped) return;
    if (text && onText(text)) {
      stop();
      return;
    }
    timer = setTimeout(() => void scan(), SCAN_INTERVAL_MS);
  };
  void scan();
  return stop;
};

/** The rear camera, reading QR codes until `onScan` accepts one. */
export function QrScanner({
  onScan,
  accessibilityLabel,
  unavailableLabel,
}: QrScannerProps) {
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
    startQrScanner(
      video,
      (text) => onScanRef.current(text),
      () => cancelled,
    ).then(
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
    <Notice tone="warning" title={unavailableLabel} />
  ) : (
    <MediaFrame accessibilityLabel={accessibilityLabel} aspectRatio={1}>
      <CameraPreview videoRef={videoRef} />
    </MediaFrame>
  );
}
