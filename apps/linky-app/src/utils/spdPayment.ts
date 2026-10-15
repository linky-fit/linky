import { parseBankPayment } from "@linky-fit/proxy-payment";

const SPAYD_FILENAME = "platba.spayd";
const SPD_QR_JPEG_FILENAME = "platba.jpg";
const SPAYD_MIME_TYPE = "application/x-shortpaymentdescriptor";
const SPD_QR_JPEG_MIME_TYPE = "image/jpeg";

const openSpdPaymentOniOS = async (spdPayload: string): Promise<void> => {
  const file = new File([spdPayload], SPAYD_FILENAME, {
    type: SPAYD_MIME_TYPE,
  });
  const shareData: ShareData = {
    files: [file],
    title: "QR platba",
  };

  if (!navigator.share || !navigator.canShare?.(shareData)) {
    throw new Error("spd-share-unavailable");
  }

  await navigator.share(shareData);
};

const openSpdPaymentOnAndroid = async (spdPayload: string): Promise<void> => {
  if (!navigator.serviceWorker) {
    throw new Error("spd-service-worker-unavailable");
  }

  await navigator.serviceWorker.ready;

  const params = new URLSearchParams({
    data: spdPayload,
  });
  const url = new URL("/platba.spayd", window.location.href);
  url.search = params.toString();

  window.location.assign(url.toString());
};

// A payme link deep-links into the installed bank app; without one the
// payme.sk site shows the same payment as a PAY by square code. Opening in a
// new tab keeps Linky open, with a same-tab fallback when popups are blocked.
const openPaymeLink = (url: string): void => {
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) window.location.assign(url);
};

export const openSpdPaymentInBank = async (
  spdPayload: string,
): Promise<void> => {
  const payment = parseBankPayment(spdPayload);
  if (payment.format === "payme") {
    openPaymeLink(payment.payload);
    return;
  }
  if (payment.format !== "spd") {
    await shareSpdPaymentQrJpeg(payment.payload);
    return;
  }

  if (/Android/i.test(navigator.userAgent)) {
    await openSpdPaymentOnAndroid(payment.payload);
    return;
  }

  await openSpdPaymentOniOS(payment.payload);
};

const canvasToJpegBlob = async (canvas: HTMLCanvasElement): Promise<Blob> => {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, SPD_QR_JPEG_MIME_TYPE, 0.95);
  });

  if (!blob) {
    throw new Error("spd-qr-share-failed");
  }

  return blob;
};

export const shareSpdPaymentQrJpeg = async (
  spdPayload: string,
): Promise<void> => {
  if (typeof navigator.share !== "function") {
    throw new Error("spd-share-unavailable");
  }

  const QRCode = await import("qrcode");
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, spdPayload, {
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
    errorCorrectionLevel: "M",
    margin: 2,
    width: 1024,
  });

  const blob = await canvasToJpegBlob(canvas);
  const file = new File([blob], SPD_QR_JPEG_FILENAME, {
    type: SPD_QR_JPEG_MIME_TYPE,
  });
  const shareData: ShareData = {
    files: [file],
    title: "QR platba",
  };

  if (
    typeof navigator.canShare === "function" &&
    !navigator.canShare(shareData)
  ) {
    throw new Error("spd-share-unavailable");
  }

  await navigator.share(shareData);
};
