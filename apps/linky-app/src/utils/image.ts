import {
  AVATAR_SIZE_PX,
  avatarCropSquare,
  type AvatarCrop,
  type OpenedImage,
} from "./imageShared";

export { AVATAR_SIZE_PX, type OpenedImage };

const loadImage = async (file: Blob): Promise<HTMLImageElement> => {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Image load failed"));
      el.src = objectUrl;
    });
  } finally {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      // ignore
    }
  }
};

const naturalSize = (img: HTMLImageElement) => ({
  width: img.naturalWidth || img.width,
  height: img.naturalHeight || img.height,
});

const canvasToBlob = async (
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> =>
  await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("image-encode-failed"));
      },
      type,
      quality,
    );
  });

export const openImage = async (file: Blob): Promise<OpenedImage> => {
  const image = await loadImage(file);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("chat-image-canvas-unavailable");
  return {
    ...naturalSize(image),
    toJpeg: async (width, height, quality) => {
      canvas.width = width;
      canvas.height = height;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, 0, 0, width, height);
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      return new Uint8Array(await blob.arrayBuffer());
    },
  };
};

/** The text of the QR code in an image file; null when none is found. */
export const decodeQrImage = async (file: Blob): Promise<string | null> => {
  const image = await loadImage(file);
  const detectorCtor = window.BarcodeDetector;
  if (detectorCtor) {
    const detector = new detectorCtor({ formats: ["qr_code"] });
    const detectorValue = (
      (await detector.detect(image))?.[0]?.rawValue ?? ""
    ).trim();
    if (detectorValue) return detectorValue;
  }

  const { width, height } = naturalSize(image);
  if (width <= 0 || height <= 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const jsQr = (await import("jsqr")).default;
  return (jsQr(imageData.data, width, height)?.data ?? "").trim() || null;
};

export const createSquareAvatarDataUrl = async (
  file: File,
  crop?: AvatarCrop,
): Promise<string> => {
  if (!file.type.startsWith("image/")) {
    throw new Error("Unsupported file");
  }

  const img = await loadImage(file);
  const { width, height } = naturalSize(img);
  if (!width || !height) throw new Error("Invalid image");
  const { side, x, y } = avatarCropSquare(width, height, crop);

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE_PX;
  canvas.height = AVATAR_SIZE_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, x, y, side, side, 0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX);

  return canvas.toDataURL("image/jpeg", 0.85);
};
