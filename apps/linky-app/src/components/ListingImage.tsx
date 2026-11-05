import type { PrivateImage } from "@linky-fit/linkstr";
import { Image, LoadingState, Stack, Text } from "@linky-fit/ui";
import React from "react";
import { usePrivateImageUrl } from "../hooks/usePrivateImageUrl";
import type { Translate } from "../i18n";

interface ListingImageProps {
  /** The uploaded photo, or a picked file not uploaded yet. */
  source: PrivateImage | File;
  label: string;
  t: Translate;
}

const aspectRatioOf = (source: PrivateImage | File): number =>
  !(source instanceof File) && source.width && source.height
    ? source.width / source.height
    : 4 / 3;

/** A listing's photo, full width and rounded, shown whole; an uploaded one is decrypted first. */
export function ListingImage({
  source,
  label,
  t,
}: ListingImageProps): React.ReactElement {
  const { ref, loaded, failed } = usePrivateImageUrl(source);
  return (
    <Stack
      ref={ref}
      width="100%"
      aspectRatio={aspectRatioOf(source)}
      maxHeight="$device"
      borderRadius="$card"
      overflow="hidden"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$neutralSoft"
      testID="listing-image"
    >
      {loaded ? (
        <Image
          src={loaded.url}
          aria-label={label}
          width="100%"
          height="100%"
          objectFit="contain"
        />
      ) : failed ? (
        <Text variant="caption" color="$colorMuted">
          {t("chatImageLoadFailed")}
        </Text>
      ) : (
        <LoadingState label={t("chatImageDecrypting")} />
      )}
    </Stack>
  );
}
