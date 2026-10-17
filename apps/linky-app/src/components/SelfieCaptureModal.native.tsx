import * as ImagePicker from "expo-image-picker";
import React from "react";
import { Platform } from "react-native";
import { useLatest } from "../hooks/useLatest";
import type { Translate } from "../i18n";
import { DeviceFile } from "../platform/deviceFile.native";
import { createSquareAvatarDataUrl } from "../utils/image";

interface SelfieCaptureModalProps {
  onCancel: () => void;
  onCaptured: (dataUrl: string) => void;
  onError: (error: unknown) => void;
  t: Translate;
}

const takeSelfie = async (t: Translate): Promise<string | null> => {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      t(
        Platform.OS === "ios"
          ? "scanPermissionDeniedIos"
          : "scanPermissionDeniedAndroid",
      ),
    );
  }
  const result = await ImagePicker.launchCameraAsync({
    cameraType: ImagePicker.CameraType.front,
    mediaTypes: ["images"],
    quality: 1,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  return createSquareAvatarDataUrl(
    new DeviceFile(
      asset.uri,
      asset.fileName ?? "selfie.jpg",
      asset.mimeType ?? "image/jpeg",
      asset.fileSize ?? 0,
    ),
  );
};

let pendingSelfie: Promise<string | null> | null = null;

// A remount while the camera is open must not open it a second time.
const takeSelfieOnce = (t: Translate): Promise<string | null> =>
  (pendingSelfie ??= takeSelfie(t).finally(() => {
    pendingSelfie = null;
  }));

/** The system camera takes the selfie; this modal has nothing of its own to show. */
export function SelfieCaptureModal({
  onCancel,
  onCaptured,
  onError,
  t,
}: SelfieCaptureModalProps): React.ReactElement {
  const callbacks = useLatest({ onCancel, onCaptured, onError });

  React.useEffect(() => {
    let cancelled = false;
    void takeSelfieOnce(t)
      .then((dataUrl) => {
        if (cancelled) return;
        if (dataUrl) callbacks.current.onCaptured(dataUrl);
        else callbacks.current.onCancel();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        callbacks.current.onError(error);
        callbacks.current.onCancel();
      });
    return () => {
      cancelled = true;
    };
  }, [callbacks, t]);

  return <></>;
}
