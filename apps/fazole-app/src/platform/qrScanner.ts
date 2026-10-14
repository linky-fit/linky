const SCAN_INTERVAL_MS = 200;
const MAX_DECODE_SIDE = 640;

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
 * `onText` accepts one (returns `true`) or the returned stop runs. Rejects
 * when the camera is unavailable or refused.
 */
export const startQrScanner = async (
  video: HTMLVideoElement,
  onText: (text: string) => boolean,
): Promise<() => void> => {
  const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints);
  const { default: jsQR } = await import("jsqr");
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };
  video.srcObject = stream;
  await video.play().catch(() => undefined);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  const scan = () => {
    if (stopped) return;
    const { videoWidth: width, videoHeight: height } = video;
    if (context && width > 0 && height > 0) {
      const scale = Math.min(1, MAX_DECODE_SIDE / Math.max(width, height));
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const text = jsQR(image.data, canvas.width, canvas.height)?.data.trim();
      if (text && onText(text)) {
        stop();
        return;
      }
    }
    timer = setTimeout(scan, SCAN_INTERVAL_MS);
  };
  scan();
  return stop;
};
