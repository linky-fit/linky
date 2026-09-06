import React from "react";
import type { MintIcon } from "../utils/mint";
import { getNextMintIconUrl } from "../utils/mint";

interface MintButtonProps {
  badgeLabel?: string;
  badgeTone?: "recommended" | "test";
  disabled?: boolean;
  fallbackLetter: string;
  getMintIconUrl: (mint: string | null | undefined) => MintIcon;
  isSelected: boolean;
  isTestMint?: boolean;
  label: string;
  mint: string;
  onClick: () => void;
}

export function MintButton({
  badgeLabel,
  badgeTone = "test",
  disabled = false,
  fallbackLetter,
  getMintIconUrl,
  isSelected,
  isTestMint = false,
  label,
  mint,
  onClick,
}: MintButtonProps) {
  const icon = getMintIconUrl(mint);
  const [renderedIconUrl, setRenderedIconUrl] = React.useState(icon.url);

  React.useEffect(() => {
    setRenderedIconUrl(icon.url);
  }, [icon.url]);

  return (
    <button
      key={mint}
      type="button"
      className={`ghost mint-choice${isTestMint ? " is-test-mint" : ""}${isSelected ? " is-selected" : ""}`}
      aria-pressed={isSelected}
      disabled={disabled}
      onClick={onClick}
    >
      {renderedIconUrl ? (
        <img
          src={renderedIconUrl}
          alt=""
          width={14}
          height={14}
          className="mint-icon"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => {
            const nextUrl = getNextMintIconUrl(renderedIconUrl, icon.origin);
            if (nextUrl) {
              setRenderedIconUrl(nextUrl);
              return;
            }
            setRenderedIconUrl(null);
          }}
        />
      ) : (
        <span aria-hidden="true" className="mint-icon-fallback">
          {fallbackLetter}
        </span>
      )}
      <span className="mint-choice-label">{label}</span>
      {badgeLabel ? (
        <span
          className={`mint-choice-badge${badgeTone === "recommended" ? " is-recommended" : ""}`}
        >
          {badgeLabel}
        </span>
      ) : null}
      {isSelected ? (
        <span className="mint-choice-check" aria-hidden="true">
          ✓
        </span>
      ) : null}
    </button>
  );
}
