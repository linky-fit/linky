import { optimizeCaseInsensitiveQrPayload } from "./qrPayload";

const QR_SIZE = 240;

/** Renders the npub as a QR data URL, optionally with a centre cutout for a badge. */
export const renderNpubQr = async (
  npub: string,
  { cutout }: { cutout: boolean },
): Promise<string> => {
  const QRCode = await import("qrcode");
  const canvas = document.createElement("canvas");

  await QRCode.toCanvas(canvas, optimizeCaseInsensitiveQrPayload(npub), {
    errorCorrectionLevel: "H",
    margin: 1,
    width: QR_SIZE,
    color: {
      dark: "#0f172a",
      light: "#ffffff",
    },
  });

  if (cutout) {
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Missing QR canvas context");
    }
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(
      QR_SIZE / 2,
      QR_SIZE / 2,
      Math.round(QR_SIZE * 0.23) / 2,
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  return canvas.toDataURL();
};
