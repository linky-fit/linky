import type { MintIcon } from "../utils/mint";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { formatChatMessagePreviewText } from "../app/lib/chatMessageDisplay";
import { hasMessageEntityPreview } from "../app/lib/messageEntityPreview";
import type { CashuTokenMessageInfo } from "../app/lib/tokenMessageInfo";
import type { ContactRowLike, LocalNostrMessage } from "../app/types/appTypes";
import { formatDisplayGeneralStatus } from "../nostrStatus";
import {
  formatContactMessageTimestamp,
  getInitials,
} from "../utils/formatting";
import { Avatar } from "./Avatar";
import { CashuTokenPill } from "./CashuTokenPill";
import type { NpubMessageContactInfo } from "./ChatMessage";
import { MessageEntityPreview } from "./MessageEntityPreview";

interface ContactCardProps {
  avatarUrl: string | null;
  contact: ContactRowLike;
  getMintIconUrl: (
    url: string | null | undefined,
  ) => Pick<MintIcon, "url"> & Partial<Omit<MintIcon, "url">>;
  getNpubMessageContactInfo: (npub: string) => NpubMessageContactInfo | null;
  hasAttention: boolean;
  isActive?: boolean;
  lastMessage?: LocalNostrMessage | null;
  onMintIconError: (origin: string, nextUrl: string | null) => void;
  onMintIconLoad: (origin: string, url: string | null) => void;
  onSelect: (contact: ContactRowLike) => void;
  statusText?: string | null;
  tokenInfo: CashuTokenMessageInfo | null;
  isUnknownContact?: boolean;
}

export const ContactCard: React.FC<ContactCardProps> = React.memo(
  ({
    avatarUrl,
    contact,
    getMintIconUrl,
    getNpubMessageContactInfo,
    hasAttention,
    isActive = false,
    lastMessage,
    onMintIconError,
    onMintIconLoad,
    onSelect,
    statusText,
    tokenInfo,
    isUnknownContact = false,
  }) => {
    const { formatDisplayedAmountText, t } = useAppShellCore();
    const initials = getInitials(contact.name ?? "");
    const contactStatus = formatDisplayGeneralStatus({
      status: statusText,
      providesLabel: t("contactStatusProvides"),
    });
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

    const directionSymbol = (() => {
      const dir = (lastMessage?.direction ?? "").trim();
      if (dir === "out") return "↗";
      if (dir === "in") return "↘";
      return "";
    })();

    const previewText = preview
      ? directionSymbol
        ? `${directionSymbol} ${preview}`
        : preview
      : "";

    const handleClick = () => onSelect(contact);
    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      }
    };

    return (
      <article
        className={`contact-card is-clickable${isActive ? " is-active" : ""}`}
        aria-current={isActive ? "page" : undefined}
        data-guide="contact-card"
        data-guide-contact-id={String(contact.id)}
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <div className="card-header">
          <div className="contact-avatar with-badge" aria-hidden="true">
            <span className="contact-avatar-inner">
              <Avatar
                pictureUrl={avatarUrl}
                fallback={initials}
                fallbackClassName="contact-avatar-fallback"
                loading="lazy"
              />
            </span>
            {hasAttention ? (
              <span className="contact-unread-dot" aria-hidden="true" />
            ) : null}
            {isUnknownContact ? (
              <span className="contact-unknown-badge" aria-hidden="true">
                ?
              </span>
            ) : null}
          </div>

          <div className="card-main">
            <div className="card-title-row">
              {contact.name ? (
                <h4 className="contact-title">
                  <span className="contact-title-text" title={contact.name}>
                    {contact.name}
                  </span>
                  {contactStatus ? (
                    <span className="contact-status-text" title={contactStatus}>
                      {contactStatus}
                    </span>
                  ) : null}
                </h4>
              ) : null}
              {lastTime ? (
                <span className="contact-card-trailing">
                  {lastTime ? (
                    <span className="muted contact-card-payment-method">
                      {lastTime}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>

            {hasMessageEntityPreview(lastText) ? (
              <MessageEntityPreview
                className="muted contact-message-entity-preview"
                content={lastText}
                directionSymbol={directionSymbol}
                getCashuTokenMessageInfo={() => tokenInfo}
                getMintIconUrl={getMintIconUrl}
                getNpubMessageContactInfo={getNpubMessageContactInfo}
              />
            ) : tokenInfo ? (
              <TokenPreview
                tokenInfo={tokenInfo}
                directionSymbol={directionSymbol}
                formatDisplayedAmountText={formatDisplayedAmountText}
                getMintIconUrl={getMintIconUrl}
                onIconLoad={onMintIconLoad}
                onIconError={onMintIconError}
              />
            ) : previewText ? (
              <div className="muted contact-card-preview">{previewText}</div>
            ) : null}
          </div>
        </div>
      </article>
    );
  },
);

interface TokenPreviewProps {
  directionSymbol: string;
  formatDisplayedAmountText: (amountSat: number) => string;
  getMintIconUrl: (
    url: string | null | undefined,
  ) => Pick<MintIcon, "url"> & Partial<Omit<MintIcon, "url">>;
  onIconError: (origin: string, nextUrl: string | null) => void;
  onIconLoad: (origin: string, url: string | null) => void;
  tokenInfo: CashuTokenMessageInfo;
}

const TokenPreview: React.FC<TokenPreviewProps> = ({
  directionSymbol,
  formatDisplayedAmountText,
  getMintIconUrl,
  onIconError,
  onIconLoad,
  tokenInfo,
}) => {
  const amountText = formatDisplayedAmountText(tokenInfo.amount ?? 0);
  return (
    <div className="muted contact-token-preview">
      {directionSymbol ? <span>{directionSymbol}</span> : null}
      <CashuTokenPill
        compact
        icon={getMintIconUrl(tokenInfo.mintUrl)}
        amountText={amountText}
        ariaLabel={amountText}
        className="chat-token-pill"
        isMuted={!tokenInfo.isValid}
        onMintIconLoad={onIconLoad}
        onMintIconError={onIconError}
      />
    </div>
  );
};
