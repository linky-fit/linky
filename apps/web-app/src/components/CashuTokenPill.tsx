import type { OperationId, TokenTransfer } from "@linky/linkshu";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import type { MintIcon } from "../utils/mint";
import { getNextMintIconUrl } from "../utils/mint";

interface TransferPillProps {
  ariaLabel: string;
  getMintIconUrl: (mint: string | null | undefined) => MintIcon;
  onMintIconError: (origin: string, nextUrl: string | null) => void;
  onMintIconLoad: (origin: string, url: string | null) => void;
  onOpenTransfer: (id: OperationId) => void;
  transfer: TokenTransfer;
}

/** A token that left or entered the wallet as text; opens its detail page. */
export const TransferPill = React.memo(function TransferPill({
  ariaLabel,
  getMintIconUrl,
  onMintIconError,
  onMintIconLoad,
  onOpenTransfer,
  transfer,
}: TransferPillProps) {
  const { formatDisplayedAmountText } = useAppShellCore();
  return (
    <CashuTokenPill
      icon={getMintIconUrl(transfer.mint)}
      amountText={formatDisplayedAmountText(transfer.amount)}
      ariaLabel={ariaLabel}
      isError={transfer.kind === "receive" && transfer.status === "failed"}
      isMuted={transfer.status !== "issued"}
      onClick={() => onOpenTransfer(transfer.id)}
      onMintIconLoad={onMintIconLoad}
      onMintIconError={onMintIconError}
    />
  );
});

interface CashuTokenPillProps {
  amountText: string;
  ariaLabel?: string;
  className?: string;
  compact?: boolean;
  icon: Pick<MintIcon, "url"> & Partial<Omit<MintIcon, "url">>;
  isError?: boolean;
  isMuted?: boolean;
  onClick?: () => void;
  onMintIconLoad?: (origin: string, url: string | null) => void;
  onMintIconError?: (origin: string, url: string | null) => void;
}

export function CashuTokenPill({
  amountText,
  ariaLabel,
  className = "",
  compact = false,
  icon,
  isError = false,
  isMuted = false,
  onClick,
  onMintIconLoad,
  onMintIconError,
}: CashuTokenPillProps) {
  const pillClassName = `pill cashu-token-pill${isError ? " pill-error" : isMuted ? " pill-muted" : ""}${compact ? " cashu-token-pill-compact" : ""}${className ? ` ${className}` : ""}`;
  const content = (
    <>
      {icon.url ? (
        <img
          src={icon.url}
          alt=""
          width={14}
          height={14}
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => {
            if (icon.origin) onMintIconLoad?.(icon.origin, icon.url);
          }}
          onError={() => {
            if (icon.origin)
              onMintIconError?.(
                icon.origin,
                getNextMintIconUrl(icon.url, icon.origin),
              );
          }}
        />
      ) : null}
      {(icon.failed || !icon.url) && icon.host ? (
        <span className="muted chat-token-pill-fallback">{icon.host}</span>
      ) : null}
      <span className="chat-token-pill-label">{amountText}</span>
    </>
  );
  return onClick ? (
    <button
      type="button"
      className={pillClassName}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <span className={pillClassName} aria-label={ariaLabel}>
      {content}
    </span>
  );
}
