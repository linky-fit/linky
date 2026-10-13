import { scanFromURLAsync } from "expo-camera";
import { File as ExpoFile } from "expo-file-system";
import {
  ImageManipulator,
  type ImageRef,
  SaveFormat,
} from "expo-image-manipulator";
import {
  bytesToDeviceFile,
  DeviceFile,
  readBlobBytes,
} from "../platform/deviceFile.native";
import {
  AVATAR_SIZE_PX,
  avatarCropSquare,
  type AvatarCrop,
  type OpenedImage,
} from "./imageShared";

export { AVATAR_SIZE_PX, type OpenedImage };

const fileUri = async (file: Blob): Promise<string> =>
  file instanceof DeviceFile
    ? file.uri
    : bytesToDeviceFile(await readBlobBytes(file), file.type).uri;

const decode = async (file: Blob): Promise<ImageRef> =>
  ImageManipulator.manipulate(await fileUri(file)).renderAsync();

const saveJpeg = (image: ImageRef, quality: number) =>
  image.saveAsync({ compress: quality, format: SaveFormat.JPEG });

export const openImage = async (file: Blob): Promise<OpenedImage> => {
  const image = await decode(file);
  return {
    height: image.height,
    width: image.width,
    toJpeg: async (width, height, quality) => {
      const resized = await ImageManipulator.manipulate(image)
        .resize({ width, height })
        .renderAsync();
      const saved = await saveJpeg(resized, quality);
      return new ExpoFile(saved.uri).bytes();
    },
  };
};

/** The text of the QR code in an image file; null when none is found. */
export const decodeQrImage = async (file: Blob): Promise<string | null> => {
  const [code] = await scanFromURLAsync(await fileUri(file), ["qr"]);
  return code?.data.trim() || null;
};

export const createSquareAvatarDataUrl = async (
  file: File,
  crop?: AvatarCrop,
): Promise<string> => {
  if (!file.type.startsWith("image/")) {
    throw new Error("Unsupported file");
  }
  const image = await decode(file);
  if (!image.width || !image.height) throw new Error("Invalid image");
  const { side, x, y } = avatarCropSquare(image.width, image.height, crop);
  const avatar = await ImageManipulator.manipulate(image)
    .crop({
      originX: Math.round(x),
      originY: Math.round(y),
      width: Math.round(side),
      height: Math.round(side),
    })
    .resize({ width: AVATAR_SIZE_PX, height: AVATAR_SIZE_PX })
    .renderAsync();
  const { base64 } = await avatar.saveAsync({
    base64: true,
    compress: 0.85,
    format: SaveFormat.JPEG,
  });
  if (!base64) throw new Error("Image encode failed");
  return `data:image/jpeg;base64,${base64}`;
};
