import { ContactRow, Row, Stack, Text } from "@linky-fit/ui";
import type { MintIcon } from "../utils/mint";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useContactSupporterBadge } from "../app/hooks/useContactSupporterBadge";
import { formatChatMessagePreviewText } from "../app/lib/chatMessageDisplay";
import { hasMessageEntityPreview } from "../app/lib/messageEntityPreview";
import type { CashuTokenMessageInfo } from "../app/lib/tokenMessageInfo";
import type { ContactRowLike, LocalNostrMessage } from "../app/types/appTypes";
import { parseProfileGeneralStatus } from "../nostrStatus";
import { getContactName } from "../utils/contactName";
import { formatContactMessageTimestamp } from "../utils/formatting";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";
import { CashuTokenPill } from "./CashuTokenPill";
import type { NpubMessageContactInfo } from "./ChatMessage";
import {
  type MessageDirection,
  MessageDirectionIcon,
  MessageEntityPreview,
} from "./MessageEntityPreview";

interface ContactCardProps {
  avatarUrl: string | null;
  contact: ContactRowLike;
  nameLabel: string;
  getMintIconUrl: (
    url: string | null | undefined,
  ) => Pick<MintIcon, "url"> & Partial<Omit<MintIcon, "url">>;
  getNpubMessageContactInfo: (npub: string) => NpubMessageContactInfo | null;
  hasAttention: boolean;
  isActive?: boolean;
  lastMessage?: LocalNostrMessage | null;
  onMintIconError: (url: string) => void;
  onSelect: (contact: ContactRowLike) => void;
  statusText?: string | null;
  tokenInfo: CashuTokenMessageInfo | null;
  isUnknownContact?: boolean;
}

export const ContactCard: React.FC<ContactCardProps> = React.memo(
  ({
    avatarUrl,
    contact,
    nameLabel,
    getMintIconUrl,
    getNpubMessageContactInfo,
    hasAttention,
    isActive = false,
    lastMessage,
    onMintIconError,
    onSelect,
    statusText,
    tokenInfo,
    isUnknownContact = false,
  }) => {
    const { formatDisplayedAmountText, t } = useAppShellCore();
    const supporter = useContactSupporterBadge(
      normalizeNpubIdentifier(contact.npub ?? "") || null,
    );
    // The offered currencies belong on the contact's page, not in the list.
    const contactStatus = parseProfileGeneralStatus(statusText).text;
    const lastText = (lastMessage?.content ?? "").trim();
    const rawDirection = (lastMessage?.direction ?? "").trim();
    const previewDirection =
      rawDirection === "in" || rawDirection === "out" ? rawDirection : null;
    const displayText = formatChatMessagePreviewText({
      content: lastText,
      direction: previewDirection,
      formatDisplayedAmountText,
      t,
    });
    const preview =
      displayText.length > 40 ? `${displayText.slice(0, 40)}…` : displayText;
    const lastTime = lastMessage
      ? formatContactMessageTimestamp(lastMessage.createdAtSec)
      : "";

    const previewContent = hasMessageEntityPreview(lastText) ? (
      <MessageEntityPreview
        content={lastText}
        direction={previewDirection}
        getCashuTokenMessageInfo={() => tokenInfo}
        getMintIconUrl={getMintIconUrl}
        getNpubMessageContactInfo={getNpubMessageContactInfo}
      />
    ) : tokenInfo ? (
      <TokenPreview
        tokenInfo={tokenInfo}
        direction={previewDirection}
        formatDisplayedAmountText={formatDisplayedAmountText}
        getMintIconUrl={getMintIconUrl}
        onIconError={onMintIconError}
      />
    ) : preview ? (
      <Row gap="$xs">
        {previewDirection ? (
          <MessageDirectionIcon direction={previewDirection} />
        ) : null}
        <Text
          variant="caption"
          color="$colorMuted"
          numberOfLines={1}
          flexShrink={1}
        >
          {preview}
        </Text>
      </Row>
    ) : null;

    return (
      <Stack
        data-guide="contact-card"
        data-guide-contact-id={String(contact.id)}
        data-unread={hasAttention || undefined}
      >
        <ContactRow
          name={nameLabel}
          avatarName={getContactName(contact) || nameLabel}
          avatarUri={avatarUrl ?? undefined}
          supporter={supporter}
          status={contactStatus || undefined}
          preview={previewContent}
          time={lastTime || undefined}
          unread={hasAttention}
          badge={isUnknownContact ? "?" : undefined}
          selected={isActive}
          onPress={() => onSelect(contact)}
        />
      </Stack>
    );
  },
);

interface TokenPreviewProps {
  direction: MessageDirection | null;
  formatDisplayedAmountText: (amountSat: number) => string;
  getMintIconUrl: (
    url: string | null | undefined,
  ) => Pick<MintIcon, "url"> & Partial<Omit<MintIcon, "url">>;
  onIconError: (url: string) => void;
  tokenInfo: CashuTokenMessageInfo;
}

const TokenPreview: React.FC<TokenPreviewProps> = ({
  direction,
  formatDisplayedAmountText,
  getMintIconUrl,
  onIconError,
  tokenInfo,
}) => {
  const amountText = formatDisplayedAmountText(tokenInfo.amount ?? 0);
  return (
    <Row gap="$xs">
      {direction ? <MessageDirectionIcon direction={direction} /> : null}
      <CashuTokenPill
        size="sm"
        mintIcon={getMintIconUrl(tokenInfo.mintUrl)}
        label={amountText}
        accessibilityLabel={amountText}
        tone={
          !tokenInfo.isValid || tokenInfo.isHiddenTestMint
            ? "neutral"
            : "accent"
        }
        onMintIconError={onIconError}
      />
    </Row>
  );
};
