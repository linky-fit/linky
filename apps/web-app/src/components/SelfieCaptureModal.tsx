import React from "react";
import type { Translate } from "../i18n";
import { ModalSheet } from "./ModalSheet";

interface SelfieCaptureModalProps {
  onCancel: () => void;
  onCaptured: (dataUrl: string) => void;
  onError: (error: unknown) => void;
  t: Translate;
}

const AVATAR_SIZE_PX = 160;

const stopStream = (stream: MediaStream) => {
  stream.getTracks().forEach((track) => track.stop());
};

export function SelfieCaptureModal({
  onCancel,
  onCaptured,
  onError,
  t,
}: SelfieCaptureModalProps): React.ReactElement {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [isReady, setIsReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    const start = async () => {
      const media = navigator.mediaDevices;
      if (!media?.getUserMedia) {
        onError(new Error(t("scanCameraError")));
        onCancel();
        return;
      }
      try {
        const stream = await media.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "user" } },
        });
        if (cancelled) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        setIsReady(true);
      } catch (error) {
        if (cancelled) return;
        onError(error);
        onCancel();
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (streamRef.current) stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [onCancel, onError, t]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !isReady) return;
    const side = Math.min(video.videoWidth, video.videoHeight);
    if (!side) return;

    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE_PX;
    canvas.height = AVATAR_SIZE_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      onError(new Error("Canvas not available"));
      return;
    }
    // Mirror horizontally so the saved selfie matches the mirrored preview.
    ctx.translate(AVATAR_SIZE_PX, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(
      video,
      (video.videoWidth - side) / 2,
      (video.videoHeight - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIZE_PX,
      AVATAR_SIZE_PX,
    );
    onCaptured(canvas.toDataURL("image/jpeg", 0.85));
  };

  return (
    <ModalSheet
      className="modal-overlay avatar-crop-overlay"
      aria-label={t("onboardingTakePhoto")}
      onClick={onCancel}
      sheetClassName="modal-sheet avatar-crop-sheet"
    >
      <div className="modal-title">{t("onboardingTakePhoto")}</div>
      <div className="avatar-crop-viewport selfie-viewport">
        <video
          ref={videoRef}
          className="selfie-video"
          autoPlay
          muted
          playsInline
        />
        <span className="avatar-crop-frame" aria-hidden="true" />
      </div>
      <div className="modal-actions avatar-crop-actions">
        <button
          type="button"
          className="btn-wide"
          disabled={!isReady}
          onClick={capture}
        >
          {t("onboardingCapturePhoto")}
        </button>
        <button type="button" className="btn-wide secondary" onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </ModalSheet>
  );
}
