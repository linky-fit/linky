import type { ImageFile } from "../services/blossom";

/** A picked image, shown from `url` until `releaseImage`. */
export interface PickedImage {
  readonly file: File;
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

export interface SquareCrop {
  /** The crop center in image pixels. */
  readonly center: { readonly x: number; readonly y: number };
  /** 1 crops the largest square, 2 one of half its side. */
  readonly zoom: number;
}

const OUTPUT_SIDE = 512;

/** The square of the image a crop covers, kept inside the image. */
export const cropSquare = (
  width: number,
  height: number,
  { center, zoom }: SquareCrop,
) => {
  const side = Math.min(width, height) / Math.max(1, zoom);
  const half = side / 2;
  const clamp = (value: number, extent: number) =>
    Math.min(extent - half, Math.max(half, value));
  return {
    x: clamp(center.x, width) - half,
    y: clamp(center.y, height) - half,
    side,
  };
};

const chooseFile = (accept: string): Promise<File | null> =>
  new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    // Attached and rendered off-screen: some mobile browsers ignore click() on detached or hidden inputs.
    Object.assign(input.style, {
      position: "fixed",
      width: "1px",
      height: "1px",
      opacity: "0",
      pointerEvents: "none",
    });
    const finish = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => finish(null));
    document.body.append(input);
    input.click();
  });

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image did not load"));
    image.src = url;
  });

/** Opens the file picker; `null` when cancelled. Rejects for a file that is no image. */
export const pickImage = async (): Promise<PickedImage | null> => {
  const file = await chooseFile("image/*");
  if (file === null) return null;
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    return {
      file,
      url,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
};

export const releaseImage = (image: PickedImage): void =>
  URL.revokeObjectURL(image.url);

const encode = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));

/** The cropped square scaled to 512 px, as WebP where the browser encodes it, else JPEG. */
export const renderSquare = async (
  picked: PickedImage,
  crop: SquareCrop,
): Promise<ImageFile> => {
  const image = await loadImage(picked.url);
  const { x, y, side } = cropSquare(picked.width, picked.height, crop);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIDE;
  canvas.height = OUTPUT_SIDE;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("canvas unavailable");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, x, y, side, side, 0, 0, OUTPUT_SIDE, OUTPUT_SIDE);
  const webp = await encode(canvas, "image/webp");
  // Safari encodes only PNG and JPEG and hands back PNG for anything else.
  const blob =
    webp?.type === "image/webp" ? webp : await encode(canvas, "image/jpeg");
  if (blob === null) throw new Error("image not encoded");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type };
};
