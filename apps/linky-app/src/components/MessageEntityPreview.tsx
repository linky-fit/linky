import { Icon, Row, Text } from "@linky-fit/ui";
import React from "react";
import { useDisplayAmounts } from "../app/hooks/shell";
import type { CashuTokenMessageInfo } from "../app/lib/tokenMessageInfo";
import { isStandaloneCashuTokenMessage } from "../app/lib/tokenText";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";
import { CashuTokenPill } from "./CashuTokenPill";
import type { NpubMessageContactInfo } from "./ChatMessage";
import { ContactPill } from "./ContactPill";

const ENTITY_PATTERN =
  /(?:nostr:)?npub1[023456789acdefghjklmnpqrstuvwxyz]+(?:@npub\.cash)?|cashu[0-9A-Za-z_-]+={0,2}/gi;

export type MessageDirection = "in" | "out";

export const MessageDirectionIcon = ({
  direction,
}: {
  direction: MessageDirection;
}) => (
  <Icon
    name={direction === "out" ? "ArrowUpRight" : "ArrowDownRight"}
    size="sm"
    color="$colorMuted"
  />
);

interface MessageEntityPreviewProps {
  content: string;
  direction?: MessageDirection | null;
  getCashuTokenMessageInfo: (text: string) => CashuTokenMessageInfo | null;
  getMintIconUrl: (mint: string | null | undefined) => {
    url: string | null;
  };
  getNpubMessageContactInfo: (npub: string) => NpubMessageContactInfo | null;
  onOpenNpubContact?: (npub: string) => void;
}

/** One line of a message with its contacts and tokens shown as pills inline, cut off at its end. */
export const MessageEntityPreview: React.FC<MessageEntityPreviewProps> = ({
  content,
  direction,
  getCashuTokenMessageInfo,
  getMintIconUrl,
  getNpubMessageContactInfo,
  onOpenNpubContact,
}) => {
  const { formatDisplayedAmountText } = useDisplayAmounts();
  const standaloneTokenInfo = isStandaloneCashuTokenMessage(content)
    ? getCashuTokenMessageInfo(content)
    : null;
  const matches = Array.from(content.matchAll(ENTITY_PATTERN));
  const segments: React.ReactNode[] = [];
  let cursor = 0;

  const pushText = (text: string) => segments.push(text);

  if (standaloneTokenInfo) {
    const icon = getMintIconUrl(standaloneTokenInfo.mintUrl);
    segments.push(
      <CashuTokenPill
        size="sm"
        key="standalone-cashu"
        mintIcon={icon}
        label={formatDisplayedAmountText(standaloneTokenInfo.amount ?? 0)}
        tone={
          !standaloneTokenInfo.isValid || standaloneTokenInfo.isHiddenTestMint
            ? "neutral"
            : "accent"
        }
      />,
    );
  }

  for (const match of standaloneTokenInfo ? [] : matches) {
    const text = match[0];
    const start = match.index ?? 0;
    if (start > cursor) pushText(content.slice(cursor, start));

    const isCashuToken = text.toLowerCase().startsWith("cashu");
    const npub = isCashuToken ? null : normalizeNpubIdentifier(text);
    const contactInfo = npub ? getNpubMessageContactInfo(npub) : null;
    const tokenInfo = isCashuToken ? getCashuTokenMessageInfo(text) : null;

    if (contactInfo) {
      segments.push(
        <ContactPill
          key={`${start}-npub`}
          info={contactInfo}
          onOpen={onOpenNpubContact}
          size="sm"
        />,
      );
    } else if (tokenInfo) {
      const icon = getMintIconUrl(tokenInfo.mintUrl);
      segments.push(
        <CashuTokenPill
          size="sm"
          key={`${start}-cashu`}
          mintIcon={icon}
          label={formatDisplayedAmountText(tokenInfo.amount ?? 0)}
          tone={
            !tokenInfo.isValid || tokenInfo.isHiddenTestMint
              ? "neutral"
              : "accent"
          }
        />,
      );
    } else {
      pushText(text);
    }
    cursor = start + text.length;
  }

  if (!standaloneTokenInfo && cursor < content.length) {
    pushText(content.slice(cursor));
  }

  return (
    <Row gap="$xs">
      {direction ? <MessageDirectionIcon direction={direction} /> : null}
      <Text
        variant="caption"
        color="$colorMuted"
        numberOfLines={1}
        flexShrink={1}
      >
        {segments}
      </Text>
    </Row>
  );
};
