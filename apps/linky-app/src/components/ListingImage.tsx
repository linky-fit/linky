import type { PrivateImage } from "@linky-fit/linkstr";
import { Image, LoadingState, Stack, Text } from "@linky-fit/ui";
import React from "react";
import { decryptPrivateImageMessage } from "../app/lib/privateImageMessage";
import { useLatest } from "../hooks/useLatest";
import type { Translate } from "../i18n";

interface ListingImageProps {
  /** The uploaded photo, or a picked file not uploaded yet. */
  source: PrivateImage | File;
  label: string;
  t: Translate;
}

const sourceKey = (source: PrivateImage | File): string =>
  source instanceof File
    ? `file:${source.name}:${source.size}:${source.lastModified}`
    : source.encryptedSha256;

/** A listing's photo, full width and rounded; an uploaded one is decrypted first. */
export function ListingImage(props: ListingImageProps): React.ReactElement {
  return <ListingImageContent key={sourceKey(props.source)} {...props} />;
}

function ListingImageContent({
  source,
  label,
  t,
}: ListingImageProps): React.ReactElement {
  const sourceRef = useLatest(source);
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const current = sourceRef.current;
    const blob =
      current instanceof File
        ? Promise.resolve(current)
        : decryptPrivateImageMessage(current);
    blob.then(
      (loaded) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(loaded);
        setUrl(objectUrl);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sourceRef]);

  return (
    <Stack
      width="100%"
      aspectRatio={4 / 3}
      maxHeight="$device"
      borderRadius="$card"
      overflow="hidden"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$neutralSoft"
      testID="listing-image"
    >
      {url ? (
        <Image
          src={url}
          aria-label={label}
          width="100%"
          height="100%"
          objectFit="cover"
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
