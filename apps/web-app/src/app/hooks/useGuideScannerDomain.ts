import { useLatest } from "../../hooks/useLatest";
import React from "react";
import {
  startNativeQrScan,
  startNativeQrScanStream,
  type NativeScanViewport,
  type NativeScanStreamHandle,
  supportsNativeQrScan,
} from "../../platform/nativeBridge";
import type { Route } from "../../types/route";
import { appendPushDebugLog } from "../../utils/pushDebugLog";
import type { ContactRowLike } from "../types/appTypes";
import {
  buildQrCameraConstraintCandidates,
  configureQrCameraTrack,
} from "../lib/qrCamera";
import { useContactsGuide } from "./guide/useContactsGuide";
import type { Translate } from "../../i18n";

interface UseGuideScannerDomainParams {
  cashuBalance: number;
  contacts: readonly ContactRowLike[];
  contactsOnboardingHasBackedUpKeys: boolean;
  contactsOnboardingHasPaid: boolean;
  contactsOnboardingHasSentMessage: boolean;
  openNewContactPage: () => void;
  onScannedText: (rawValue: string) => Promise<void>;
  pushToast: (message: string) => void;
  route: Route;
  t: Translate;
}

type ScanEntryPoint = "contacts" | "receive" | "send";

type UseGuideScannerDomainResult = ReturnType<typeof useContactsGuide> & {
  closeScan: () => void;
  cycleScanCamera: () => void;
  openScan: () => void;
  openReceiveScan: () => void;
  openWalletScan: () => void;
  scanAllowsManualContact: boolean;
  scanCameraLabel: string | null;
  scanCanSwitchCamera: boolean;
  scanEntryPoint: ScanEntryPoint | null;
  scanIsOpen: boolean;
  scanVideoRef: React.RefObject<HTMLVideoElement | null>;
};

const MAX_QR_DECODE_SIDE = 640;

const readNativeScanViewport = (): NativeScanViewport | null => {
  const header = document.querySelector(".scan-header");
  const footer = document.querySelector(".scan-footer");
  if (!(header instanceof HTMLElement) || !(footer instanceof HTMLElement)) {
    return null;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const top = Math.max(0, header.getBoundingClientRect().bottom);
  const bottom = Math.min(viewportHeight, footer.getBoundingClientRect().top);
  const height = bottom - top;

  if (viewportWidth <= 0 || viewportHeight <= 0 || height <= 0) {
    return null;
  }

  return {
    height,
    left: 0,
    top,
    viewportHeight,
    viewportWidth,
    width: viewportWidth,
  };
};

const readCameraPermissionState = async (): Promise<string | null> => {
  if (!navigator.permissions?.query) return null;
  const result = await navigator.permissions.query({ name: "camera" });
  return result.state;
};

export const useGuideScannerDomain = ({
  cashuBalance,
  contacts,
  contactsOnboardingHasBackedUpKeys,
  contactsOnboardingHasPaid,
  contactsOnboardingHasSentMessage,
  openNewContactPage,
  onScannedText,
  pushToast,
  route,
  t,
}: UseGuideScannerDomainParams): UseGuideScannerDomainResult => {
  const contactsGuideDomain = useContactsGuide({
    cashuBalance,
    contacts,
    contactsOnboardingHasBackedUpKeys,
    contactsOnboardingHasPaid,
    contactsOnboardingHasSentMessage,
    openNewContactPage,
    route,
  });

  const [scanIsOpen, setScanIsOpen] = React.useState(false);
  const [scanEntryPoint, setScanEntryPoint] =
    React.useState<ScanEntryPoint | null>(null);
  const [scanStream, setScanStream] = React.useState<MediaStream | null>(null);
  const [scanCameraDevices, setScanCameraDevices] = React.useState<
    readonly MediaDeviceInfo[]
  >([]);
  const [scanCameraDeviceId, setScanCameraDeviceId] = React.useState<
    string | null
  >(null);

  const scanVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const scanOpenRequestIdRef = React.useRef(0);
  const scanIsOpenRef = React.useRef(false);
  const nativeScanHandleRef = React.useRef<NativeScanStreamHandle | null>(null);
  const preferredCameraDeviceIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    scanIsOpenRef.current = scanIsOpen;
  }, [scanIsOpen]);

  const logScanDebug = React.useCallback(
    (message: string, details?: Record<string, unknown>) => {
      appendPushDebugLog("client", `scan ${message}`, details);
    },
    [],
  );

  const stopScanStream = React.useCallback(() => {
    const nativeScanHandle = nativeScanHandleRef.current;
    nativeScanHandleRef.current = null;
    try {
      nativeScanHandle?.stop();
    } catch {
      // ignore
    }

    const video = scanVideoRef.current;
    if (video) {
      try {
        video.pause();
      } catch {
        // ignore
      }
      try {
        video.srcObject = null;
      } catch {
        // ignore
      }
    }

    setScanStream((prev) => {
      if (prev) {
        for (const track of prev.getTracks()) {
          try {
            track.stop();
          } catch {
            // ignore
          }
        }
      }

      return null;
    });
  }, []);

  const closeScan = React.useCallback(() => {
    scanIsOpenRef.current = false;
    setScanIsOpen(false);
    setScanEntryPoint(null);
    setScanCameraDevices([]);
    setScanCameraDeviceId(null);
    preferredCameraDeviceIdRef.current = null;
    scanOpenRequestIdRef.current += 1;
    stopScanStream();
  }, [stopScanStream]);

  const handleScannedTextRef = useLatest(onScannedText);

  const handleDetectedScanValue = React.useCallback(
    async (value: string) => {
      await handleScannedTextRef.current(value);
      return true;
    },
    [handleScannedTextRef],
  );

  const handleNativeScanResult = React.useCallback(
    async (
      requestId: number,
      result: {
        cancelled: boolean;
        message?: string;
        value: string | null;
      },
    ) => {
      if (
        requestId !== scanOpenRequestIdRef.current ||
        !scanIsOpenRef.current
      ) {
        return;
      }

      const value = (result.value ?? "").trim();
      if (value) {
        const nativeScanHandle = nativeScanHandleRef.current;
        nativeScanHandleRef.current = null;
        try {
          nativeScanHandle?.stop();
        } catch {
          // ignore
        }

        await handleDetectedScanValue(value);
        return;
      }

      if (result.cancelled) {
        closeScan();
        return;
      }

      const message = (result.message ?? "").trim();
      logScanDebug("native scan failed", {
        message,
      });
      pushToast(
        /permission/i.test(message) || /denied/i.test(message)
          ? t("scanPermissionDenied")
          : message || t("scanCameraError"),
      );
      closeScan();
    },
    [closeScan, handleDetectedScanValue, logScanDebug, pushToast, t],
  );

  const openScanForEntryPoint = React.useCallback(
    (entryPoint: ScanEntryPoint) => {
      stopScanStream();
      scanIsOpenRef.current = true;
      setScanEntryPoint(entryPoint);
      setScanIsOpen(true);

      const requestId = (scanOpenRequestIdRef.current += 1);

      const openNativeScan = () => {
        if (!supportsNativeQrScan()) {
          return false;
        }

        const nativeScanHandle = startNativeQrScanStream((result) => {
          void handleNativeScanResult(requestId, result);
        }, readNativeScanViewport);

        if (nativeScanHandle) {
          nativeScanHandleRef.current = nativeScanHandle;
          return true;
        }

        const nativeScan = startNativeQrScan();
        if (nativeScan) {
          void nativeScan.then((result) => {
            void handleNativeScanResult(requestId, result);
          });
          return true;
        }

        return false;
      };

      if (openNativeScan()) {
        logScanDebug("native scanner opened", { entryPoint });
        return;
      }

      const media: MediaDevices | undefined = navigator.mediaDevices;

      if (!media?.getUserMedia) {
        pushToast(t("scanCameraError"));
        stopScanStream();
        return;
      }

      if (typeof globalThis.isSecureContext === "boolean" && !isSecureContext) {
        pushToast(t("scanRequiresHttps"));
        stopScanStream();
        return;
      }

      void (async () => {
        try {
          const acceptStream = async (
            stream: MediaStream,
            strategy: string,
          ) => {
            if (
              requestId !== scanOpenRequestIdRef.current ||
              !scanIsOpenRef.current
            ) {
              for (const track of stream.getTracks()) {
                try {
                  track.stop();
                } catch {
                  // ignore
                }
              }
              return false;
            }

            const videoTrack = stream.getVideoTracks()[0];
            const cameraDetails = videoTrack
              ? await configureQrCameraTrack(videoTrack)
              : {};

            if (
              requestId !== scanOpenRequestIdRef.current ||
              !scanIsOpenRef.current
            ) {
              for (const track of stream.getTracks()) {
                try {
                  track.stop();
                } catch {
                  // ignore
                }
              }
              return false;
            }

            const cameraDeviceId = cameraDetails.deviceId;
            const selectedDeviceId =
              typeof cameraDeviceId === "string" ? cameraDeviceId : null;
            setScanCameraDeviceId(selectedDeviceId);
            try {
              const devices = await media.enumerateDevices();
              if (
                requestId === scanOpenRequestIdRef.current &&
                scanIsOpenRef.current
              ) {
                setScanCameraDevices(
                  devices.filter((device) => device.kind === "videoinput"),
                );
              }
            } catch {
              if (
                requestId === scanOpenRequestIdRef.current &&
                scanIsOpenRef.current
              ) {
                setScanCameraDevices([]);
              }
            }

            if (
              requestId !== scanOpenRequestIdRef.current ||
              !scanIsOpenRef.current
            ) {
              for (const track of stream.getTracks()) {
                try {
                  track.stop();
                } catch {
                  // ignore
                }
              }
              return false;
            }

            logScanDebug("web camera opened", {
              ...cameraDetails,
              entryPoint,
              strategy,
            });
            setScanStream(stream);
            return true;
          };

          let lastError: unknown = null;
          for (const candidate of buildQrCameraConstraintCandidates(
            preferredCameraDeviceIdRef.current,
          )) {
            try {
              const stream = await media.getUserMedia(candidate.constraints);
              await acceptStream(stream, candidate.strategy);
              return;
            } catch (error) {
              lastError = error;
              const errorName =
                typeof error === "object" && error !== null
                  ? String(Reflect.get(error, "name") ?? "")
                  : "";
              if (errorName === "NotAllowedError") throw error;
            }
          }
          throw lastError ?? new Error("No camera matched the constraints");
        } catch (error) {
          const errorObject =
            typeof error === "object" && error !== null ? error : null;
          const name = String(
            errorObject ? Reflect.get(errorObject, "name") : "",
          ).trim();
          const message = String(
            errorObject ? Reflect.get(errorObject, "message") : error,
          ).trim();

          let permissionState: string | null = null;
          try {
            permissionState = await readCameraPermissionState();
          } catch {
            // ignore
          }

          logScanDebug("getUserMedia failed", {
            href: globalThis.location?.href ?? null,
            isSecureContext:
              typeof globalThis.isSecureContext === "boolean"
                ? globalThis.isSecureContext
                : null,
            message,
            name,
            permissionState,
          });

          const isPermissionDenied =
            name === "NotAllowedError" ||
            /permission/i.test(message) ||
            /denied/i.test(message);

          pushToast(
            isPermissionDenied
              ? t("scanPermissionDenied")
              : t("scanCameraError"),
          );
          stopScanStream();
        }
      })();
    },
    [handleNativeScanResult, logScanDebug, pushToast, stopScanStream, t],
  );

  const openScan = React.useCallback(() => {
    preferredCameraDeviceIdRef.current = null;
    openScanForEntryPoint("contacts");
  }, [openScanForEntryPoint]);

  const openReceiveScan = React.useCallback(() => {
    preferredCameraDeviceIdRef.current = null;
    openScanForEntryPoint("receive");
  }, [openScanForEntryPoint]);

  const openWalletScan = React.useCallback(() => {
    preferredCameraDeviceIdRef.current = null;
    openScanForEntryPoint("send");
  }, [openScanForEntryPoint]);

  const cycleScanCamera = React.useCallback(() => {
    if (!scanEntryPoint || scanCameraDevices.length < 2) return;

    const currentIndex = scanCameraDevices.findIndex(
      (device) => device.deviceId === scanCameraDeviceId,
    );
    const nextIndex =
      currentIndex < 0 ? 0 : (currentIndex + 1) % scanCameraDevices.length;
    const nextDevice = scanCameraDevices[nextIndex];
    if (!nextDevice) return;

    preferredCameraDeviceIdRef.current = nextDevice.deviceId;
    openScanForEntryPoint(scanEntryPoint);
  }, [
    openScanForEntryPoint,
    scanCameraDeviceId,
    scanCameraDevices,
    scanEntryPoint,
  ]);

  const scanCameraLabel = React.useMemo(() => {
    if (!scanCameraDeviceId) return null;
    const selectedDevice = scanCameraDevices.find(
      (device) => device.deviceId === scanCameraDeviceId,
    );
    return selectedDevice?.label.trim() || null;
  }, [scanCameraDeviceId, scanCameraDevices]);

  React.useEffect(() => {
    if (!scanIsOpen) return;
    if (!scanStream) return;

    let cancelled = false;
    let stream: MediaStream | null = scanStream;
    let rafId: number | null = null;
    let lastScanAt = 0;
    let handled = false;

    const stop = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      rafId = null;

      const video = scanVideoRef.current;
      if (video) {
        try {
          video.pause();
        } catch {
          // ignore
        }
        try {
          video.srcObject = null;
        } catch {
          // ignore
        }
      }

      if (stream) {
        for (const track of stream.getTracks()) {
          try {
            track.stop();
          } catch {
            // ignore
          }
        }
      }
      stream = null;
    };

    const run = async () => {
      if (cancelled) {
        stop();
        return;
      }

      const video = scanVideoRef.current;
      if (!video) {
        stop();
        return;
      }

      try {
        video.srcObject = stream;
      } catch {
        // ignore
      }

      try {
        video.setAttribute("playsinline", "true");
        video.muted = true;
      } catch {
        // ignore
      }

      try {
        await video.play();
      } catch {
        // ignore
      }

      const detectorCtor = window.BarcodeDetector;
      const detector = detectorCtor
        ? new detectorCtor({ formats: ["qr_code"] })
        : null;
      const jsQr = detector ? null : (await import("jsqr")).default;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = async () => {
        if (cancelled) {
          return;
        }
        if (!video || video.readyState < 2) {
          rafId = window.requestAnimationFrame(() => {
            void tick();
          });
          return;
        }

        const now = Date.now();
        if (now - lastScanAt < 200) {
          rafId = window.requestAnimationFrame(() => {
            void tick();
          });
          return;
        }
        lastScanAt = now;

        try {
          if (handled) {
            return;
          }

          if (detector) {
            const codes = await detector.detect(video);
            const value = (codes?.[0]?.rawValue ?? "").trim();
            if (value) {
              const didHandle = await handleDetectedScanValue(value);
              if (didHandle) {
                handled = true;
                stop();
                return;
              }
            }
          } else if (jsQr && ctx) {
            const width = video.videoWidth || 0;
            const height = video.videoHeight || 0;
            if (width > 0 && height > 0) {
              const scale = Math.min(
                1,
                MAX_QR_DECODE_SIDE / Math.max(width, height),
              );
              const decodeWidth = Math.round(width * scale);
              const decodeHeight = Math.round(height * scale);
              if (
                canvas.width !== decodeWidth ||
                canvas.height !== decodeHeight
              ) {
                canvas.width = decodeWidth;
                canvas.height = decodeHeight;
              }
              ctx.drawImage(video, 0, 0, decodeWidth, decodeHeight);
              const imageData = ctx.getImageData(
                0,
                0,
                decodeWidth,
                decodeHeight,
              );
              const result = jsQr(imageData.data, decodeWidth, decodeHeight);
              const value = (result?.data ?? "").trim();
              if (value) {
                const didHandle = await handleDetectedScanValue(value);
                if (didHandle) {
                  handled = true;
                  stop();
                  return;
                }
              }
            }
          }
        } catch {
          // ignore and continue scanning
        }

        rafId = window.requestAnimationFrame(() => {
          void tick();
        });
      };

      rafId = window.requestAnimationFrame(() => {
        void tick();
      });
    };

    void run();
    return () => {
      cancelled = true;
      stop();
    };
  }, [handleDetectedScanValue, scanIsOpen, scanStream]);

  return {
    closeScan,
    cycleScanCamera,
    ...contactsGuideDomain,
    openScan,
    openReceiveScan,
    openWalletScan,
    scanAllowsManualContact: scanEntryPoint === "contacts",
    scanCameraLabel,
    scanCanSwitchCamera: scanCameraDevices.length > 1,
    scanEntryPoint,
    scanIsOpen,
    scanVideoRef,
  };
};
