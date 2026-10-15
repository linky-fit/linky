import { Button, CameraPreview, Dialog, MediaFrame, Row } from "@linky-fit/ui";
import React from "react";
import type { Translate } from "../i18n";
import { AVATAR_SIZE_PX } from "../utils/image";

interface SelfieCaptureModalProps {
  onCancel: () => void;
  onCaptured: (dataUrl: string) => void;
  onError: (error: unknown) => void;
  t: Translate;
}

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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={t("onboardingTakePhoto")}
      actions={
        <Row gap="$sm">
          <Button flex={1} disabled={!isReady} onPress={capture}>
            {t("onboardingCapturePhoto")}
          </Button>
          <Button flex={1} variant="secondary" onPress={onCancel}>
            {t("cancel")}
          </Button>
        </Row>
      }
    >
      <MediaFrame accessibilityLabel={t("onboardingTakePhoto")}>
        <CameraPreview videoRef={videoRef} mirrored />
      </MediaFrame>
    </Dialog>
  );
}
