import React from "react";
import {
  ANIMATED_QR_FRAME_MS,
  createAnimatedQrFrames,
} from "../../../utils/animatedQr";

export interface TokenQr {
  /** Data URL of the frame to show, or null while there is nothing to show. */
  src: string | null;
  /** Frames in one pass, or null while showing a static QR. */
  frameCount: number | null;
  canToggleAnimation: boolean;
  isTooLargeForStatic: boolean;
}

/**
 * Largest QR version still shown as one static code (97×97 modules). A phone
 * camera reads that off another phone's screen reliably; the denser codes a
 * version-40 symbol allows fit the data but not the lens. NUT-16 would animate
 * sooner (past two proofs), but a static code is readable by wallets without
 * NUT-16, so it is kept as long as it stays scannable.
 */
export const STATIC_QR_MAX_VERSION = 20;

/** The QR version a payload needs at level M, or null past version 40. */
export const staticQrVersion = async (
  payload: string,
): Promise<number | null> => {
  const QRCode = await import("qrcode");
  try {
    const { version }: { version: number } = QRCode.create(payload, {
      errorCorrectionLevel: "M",
    });
    return version;
  } catch {
    return null;
  }
};

const renderQr = async (payload: string): Promise<string> => {
  const QRCode = await import("qrcode");
  return QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 2 });
};

/**
 * A token's QR, animated when it has to be. A single code is better whenever
 * a camera can read it — it can be photographed, shared as an image, and read
 * by anything — so the animation (NUT-16) takes over only past the version a
 * phone screen still scans, where the page used to show a code too dense to
 * read or nothing at all. Disabling animation uses the full static capacity.
 */
export const useTokenQr = (
  tokenText: string,
  animationEnabled = true,
): TokenQr => {
  const [src, setSrc] = React.useState<string | null>(null);
  const [frameCount, setFrameCount] = React.useState<number | null>(null);
  const [canToggleAnimation, setCanToggleAnimation] = React.useState(false);
  const [isTooLargeForStatic, setIsTooLargeForStatic] = React.useState(false);

  React.useEffect(() => {
    setSrc(null);
    setFrameCount(null);
    const payload = tokenText.trim();
    if (!payload) {
      setCanToggleAnimation(false);
      setIsTooLargeForStatic(false);
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const animate = async () => {
      const frames = await createAnimatedQrFrames(payload);
      if (cancelled) return;
      setFrameCount(frames.total);

      // Each tick renders the part the encoder hands out next. Past the first
      // pass those are fountain parts, so a receiver that missed one does not
      // have to wait for that exact frame to come round again.
      const showNextFrame = async () => {
        const frame = frames.next();
        const rendered = await renderQr(frame);
        if (!cancelled) setSrc(rendered);
      };

      await showNextFrame();
      if (cancelled) return;
      timer = window.setInterval(() => {
        void showNextFrame();
      }, ANIMATED_QR_FRAME_MS);
    };

    const generate = async () => {
      const version = await staticQrVersion(payload);
      if (cancelled) return;
      const needsAnimation =
        version === null || version > STATIC_QR_MAX_VERSION;
      setCanToggleAnimation(needsAnimation);
      setIsTooLargeForStatic(version === null);
      if (needsAnimation && animationEnabled) {
        await animate();
      } else if (version !== null) {
        const rendered = await renderQr(payload);
        if (!cancelled) setSrc(rendered);
      }
    };

    void generate().catch(() => {
      if (!cancelled) {
        setSrc(null);
        setFrameCount(null);
      }
    });

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [tokenText, animationEnabled]);

  return { src, frameCount, canToggleAnimation, isTooLargeForStatic };
};
