import { Image } from "tamagui";
import type { AvatarPhotoProps } from "./avatar-photo";

export type { AvatarPhotoProps } from "./avatar-photo";

/** A profile photo filling its avatar circle. */
export function AvatarPhoto({ uri, onError }: AvatarPhotoProps) {
  return (
    <Image
      src={uri}
      width="100%"
      height="100%"
      objectFit="cover"
      aria-hidden
      onError={onError}
    />
  );
}
