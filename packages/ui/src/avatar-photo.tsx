import { SvgUri, SvgXml } from "react-native-svg";
import { Image } from "tamagui";
import { svgDataUriXml } from "./svg-data-uri";

export interface AvatarPhotoProps {
  uri: string;
  onError: () => void;
}

// React Native's Image draws no SVG, which generated avatars (DiceBear) are.
const SVG_URI = /[./]svg(?:[?#]|$)/i;

/** A profile photo filling its avatar circle. */
export function AvatarPhoto({ uri, onError }: AvatarPhotoProps) {
  const dataXml = svgDataUriXml(uri);
  if (dataXml !== null) {
    return (
      <SvgXml xml={dataXml} width="100%" height="100%" onError={onError} />
    );
  }
  return SVG_URI.test(uri) ? (
    <SvgUri uri={uri} width="100%" height="100%" onError={onError} />
  ) : (
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
