import React from "react";
import type { MintIcon as MintIconSource } from "../utils/mint";
import { formatMintLabel, getNextMintIconUrl } from "../utils/mint";

interface MintIconProps {
  getMintIconUrl: (mint: string | null | undefined) => MintIconSource;
  mint: string;
}

const fallbackLetterOf = (mint: string): string =>
  (formatMintLabel(mint).match(/[a-z]/i)?.[0] ?? "?").toUpperCase();

export function MintIcon({ getMintIconUrl, mint }: MintIconProps) {
  const icon = getMintIconUrl(mint);
  const [renderedIconUrl, setRenderedIconUrl] = React.useState(icon.url);

  React.useEffect(() => {
    setRenderedIconUrl(icon.url);
  }, [icon.url]);

  if (!renderedIconUrl) {
    return (
      <span aria-hidden="true" className="mint-icon-fallback">
        {fallbackLetterOf(mint)}
      </span>
    );
  }

  return (
    <img
      src={renderedIconUrl}
      alt=""
      width={14}
      height={14}
      className="mint-icon"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() =>
        setRenderedIconUrl(getNextMintIconUrl(renderedIconUrl, icon.origin))
      }
    />
  );
}
