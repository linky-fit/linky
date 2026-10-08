export const AVATAR_SIZE_PX = 512;

export const createSquareAvatarDataUrl = async (
  file: File,
  crop?: {
    centerX: number;
    centerY: number;
    zoom: number;
  },
): Promise<string> => {
  if (!file.type.startsWith("image/")) {
    throw new Error("Unsupported file");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Image load failed"));
      el.src = objectUrl;
    });

    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    if (!sw || !sh) throw new Error("Invalid image");

    const zoom = Math.max(1, crop?.zoom ?? 1);
    const side = Math.min(sw, sh) / zoom;
    const halfSide = side / 2;
    const centerX = Math.min(
      sw - halfSide,
      Math.max(halfSide, crop?.centerX ?? sw / 2),
    );
    const centerY = Math.min(
      sh - halfSide,
      Math.max(halfSide, crop?.centerY ?? sh / 2),
    );
    const sx = centerX - halfSide;
    const sy = centerY - halfSide;

    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE_PX;
    canvas.height = AVATAR_SIZE_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not available");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      img,
      sx,
      sy,
      side,
      side,
      0,
      0,
      AVATAR_SIZE_PX,
      AVATAR_SIZE_PX,
    );

    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      // ignore
    }
  }
};
