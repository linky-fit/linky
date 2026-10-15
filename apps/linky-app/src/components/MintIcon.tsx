import { Avatar } from "@linky-fit/ui";
import type { AvatarSize } from "@linky-fit/ui";
import React from "react";
import type { MintIcon as MintIconSource } from "../utils/mint";
import { formatMintLabel, getNextMintIconUrl } from "../utils/mint";

interface MintIconProps {
  getMintIconUrl: (mint: string | null | undefined) => MintIconSource;
  mint: string;
  size?: AvatarSize;
}

const fallbackLetterOf = (mint: string): string =>
  (formatMintLabel(mint).match(/[a-z]/i)?.[0] ?? "?").toUpperCase();

export function MintIcon({ getMintIconUrl, mint, size = "xs" }: MintIconProps) {
  const icon = getMintIconUrl(mint);
  const [renderedIconUrl, setRenderedIconUrl] = React.useState(icon.url);

  React.useEffect(() => {
    setRenderedIconUrl(icon.url);
  }, [icon.url]);

  return (
    <Avatar
      name={formatMintLabel(mint)}
      uri={renderedIconUrl ?? undefined}
      size={size}
      fallback={fallbackLetterOf(mint)}
      onError={(failedUrl) =>
        setRenderedIconUrl(getNextMintIconUrl(failedUrl, icon.origin))
      }
    />
  );
}
