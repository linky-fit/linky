import type { OperationId, TokenTransfer } from "@linky-fit/linkshu";
import { Avatar, Pill, Text } from "@linky-fit/ui";
import type { PillProps } from "@linky-fit/ui";
import React from "react";
import { useDisplayAmounts } from "../app/hooks/shell";
import type { MintIcon } from "../utils/mint";

interface TransferPillProps {
  ariaLabel: string;
  getMintIconUrl: (mint: string | null | undefined) => MintIcon;
  onMintIconError: (url: string) => void;
  onOpenTransfer: (id: OperationId) => void;
  transfer: TokenTransfer;
}

/** A token that left or entered the wallet as text; opens its detail page. */
export const TransferPill = React.memo(function TransferPill({
  ariaLabel,
  getMintIconUrl,
  onMintIconError,
  onOpenTransfer,
  transfer,
}: TransferPillProps) {
  const { formatDisplayedAmountText } = useDisplayAmounts();
  return (
    <CashuTokenPill
      mintIcon={getMintIconUrl(transfer.mint)}
      label={formatDisplayedAmountText(transfer.amount)}
      accessibilityLabel={ariaLabel}
      tone={
        transfer.kind === "receive" && transfer.status === "failed"
          ? "danger"
          : transfer.status !== "issued"
            ? "neutral"
            : "accent"
      }
      onPress={() => onOpenTransfer(transfer.id)}
      onMintIconError={onMintIconError}
    />
  );
});

interface CashuTokenPillProps extends Pick<
  PillProps,
  "label" | "hint" | "tone" | "size" | "onPress" | "accessibilityLabel"
> {
  mintIcon: Pick<MintIcon, "url"> & Partial<Omit<MintIcon, "url">>;
  onMintIconError?: ((url: string) => void) | undefined;
}

export function CashuTokenPill({
  mintIcon,
  onMintIconError,
  ...pill
}: CashuTokenPillProps) {
  const host = mintIcon.host ?? null;
  return (
    <Pill
      testID="cashu-token-pill"
      {...pill}
      leading={
        <>
          {mintIcon.url ? (
            <Avatar
              name={host ?? pill.label}
              uri={mintIcon.url}
              size="xs"
              onError={onMintIconError}
            />
          ) : null}
          {(mintIcon.failed || !mintIcon.url) && host ? (
            <Text variant="caption" color="$colorMuted">
              {host}
            </Text>
          ) : null}
        </>
      }
    />
  );
}
