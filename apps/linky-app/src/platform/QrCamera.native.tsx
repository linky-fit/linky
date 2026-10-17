import { Stack } from "@linky-fit/ui";
import { Camera, CameraView, type PermissionResponse } from "expo-camera";
import React, { type Ref } from "react";
import { reportNativeQrScan } from "./nativeBridge.native";

let pendingPermission: Promise<PermissionResponse> | null = null;

// A remount while the system prompt is up must not queue a second prompt.
const requestCameraPermission = (): Promise<PermissionResponse> =>
  (pendingPermission ??= Camera.requestCameraPermissionsAsync().finally(() => {
    pendingPermission = null;
  }));

interface QrCameraProps {
  videoRef: Ref<HTMLVideoElement>;
}

/** The scanner's live picture; decoded QR codes go to the running native scan. */
export const QrCamera: (props: QrCameraProps) => React.JSX.Element = () => {
  const [granted, setGranted] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void requestCameraPermission()
      .then((permission) => {
        if (cancelled) return;
        if (permission.granted) setGranted(true);
        else
          reportNativeQrScan({
            cancelled: false,
            message: "Camera permission denied",
            value: null,
          });
      })
      .catch(() => {
        if (!cancelled) reportNativeQrScan({ cancelled: false, value: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!granted) return <Stack flex={1} />;
  return (
    <CameraView
      // eslint-disable-next-line linky-ui/ui-only -- CameraView takes no token props
      style={{ flex: 1 }}
      facing="back"
      barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
      onBarcodeScanned={({ data }) =>
        reportNativeQrScan({ cancelled: false, value: data })
      }
    />
  );
};
