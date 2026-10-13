export const AVATAR_SIZE_PX = 512;

export interface AvatarCrop {
  centerX: number;
  centerY: number;
  zoom: number;
}

/** The square of a `width`×`height` image an avatar shows: centred, or around `crop` kept inside the image. */
export const avatarCropSquare = (
  width: number,
  height: number,
  crop?: AvatarCrop,
): { side: number; x: number; y: number } => {
  const zoom = Math.max(1, crop?.zoom ?? 1);
  const side = Math.min(width, height) / zoom;
  const halfSide = side / 2;
  const centerX = Math.min(
    width - halfSide,
    Math.max(halfSide, crop?.centerX ?? width / 2),
  );
  const centerY = Math.min(
    height - halfSide,
    Math.max(halfSide, crop?.centerY ?? height / 2),
  );
  return { side, x: centerX - halfSide, y: centerY - halfSide };
};

/** A decoded image that can be re-encoded at other sizes. */
export interface OpenedImage {
  height: number;
  width: number;
  /** The image scaled to `width`×`height`, as JPEG bytes at `quality` (0–1). */
  toJpeg: (
    width: number,
    height: number,
    quality: number,
  ) => Promise<Uint8Array>;
}
