import type { PrivateImage } from "@linky-fit/linkstr";
import { Icon, Image, LoadingState, Stack, Text } from "@linky-fit/ui";
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

/** A listing's photo as a small square for a list row, cropped to fill; a placeholder until it is decrypted. */
export function ListingThumbnail({
  source,
  label,
}: {
  source: PrivateImage;
  label: string;
}): React.ReactElement {
  const { ref, loaded } = usePrivateImageUrl(source);
  return (
    <Stack
      ref={ref}
      width="$row"
      height="$row"
      borderRadius="$sm"
      overflow="hidden"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$neutralSoft"
      testID="listing-thumbnail"
    >
      {loaded ? (
        <Image
          src={loaded.url}
          aria-label={label}
          width="100%"
          height="100%"
          objectFit="cover"
        />
      ) : (
        <Icon name="Package" color="$colorMuted" />
      )}
    </Stack>
  );
}
