import { Icon, Image, Stack, border, type IconName } from "@linky-fit/ui";
import React, { useState } from "react";

/**
 * The accent-ringed hero of the login dialogs: the site's logo when it has
 * one that loads, the icon otherwise.
 */
export function LoginIconRing({
  icon,
  image,
}: {
  icon: IconName;
  image?: string | null;
}): React.ReactElement {
  const [failedImage, setFailedImage] = useState<string>();
  const showImage = image != null && image !== failedImage;
  return (
    <Stack
      width="$hero"
      height="$hero"
      alignItems="center"
      justifyContent="center"
      borderRadius="$pill"
      borderWidth={border.emphasis}
      borderColor="$accent"
      overflow="hidden"
    >
      {showImage ? (
        <Image
          src={image}
          width="100%"
          height="100%"
          objectFit="cover"
          aria-hidden
          onError={() => setFailedImage(image)}
        />
      ) : (
        <Icon name={icon} size="xl" color="$accent" />
      )}
    </Stack>
  );
}
