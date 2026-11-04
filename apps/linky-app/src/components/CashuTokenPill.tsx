import type { OperationId, TokenTransfer } from "@linky-fit/linkshu";
import { Avatar, Pill, Pressable, Row, Stack, Text } from "@linky-fit/ui";
import type { PillProps } from "@linky-fit/ui";
import React from "react";
import { useDisplayAmounts } from "../app/hooks/shell";
import { fallbackLetterOf, type MintIcon } from "../utils/mint";

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
              fallback={host ? fallbackLetterOf(host) : undefined}
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

/** A message that is only a token: its amount fills the bubble and the mint is a caption under it. */
export function CashuTokenAmount({
  mintIcon,
  onMintIconError,
  label,
  hint,
  tone,
  onPress,
  accessibilityLabel,
}: CashuTokenPillProps) {
  const host = mintIcon.host ?? null;
  // Without a unit to switch to there is nothing to press, and a disabled button would fade.
  const Frame = onPress ? Pressable : Stack;
  return (
    <Frame
      testID="cashu-token-pill"
      aria-label={accessibilityLabel}
      onPress={onPress}
      flexDirection="column"
      alignItems="flex-start"
      gap="$xxs"
    >
      <Text
        variant="heading"
        color={tone === "danger" ? "$dangerText" : "$colorStrong"}
        fontVariant={["tabular-nums"]}
      >
        {label}
      </Text>
      {host || hint ? (
        <Row gap="$xs">
          {mintIcon.url && !mintIcon.failed ? (
            <Avatar
              name={host ?? label}
              uri={mintIcon.url}
              size="xs"
              fallback={host ? fallbackLetterOf(host) : undefined}
              onError={onMintIconError}
            />
          ) : null}
          <Text variant="caption" color="$colorMuted" numberOfLines={1}>
            {[host, hint].filter(Boolean).join(" · ")}
          </Text>
        </Row>
      ) : null}
    </Frame>
  );
}
