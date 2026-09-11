import { Image } from "tamagui";

export interface ImagePreviewProps {
  uri: string;
  label: string;
}

export function ImagePreview({ uri, label }: ImagePreviewProps) {
  return (
    <Image
      src={uri}
      alt={label}
      width="100%"
      height={320}
      objectFit="contain"
      borderRadius="$sm"
    />
  );
}
