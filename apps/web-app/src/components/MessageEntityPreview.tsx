import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import type { CashuTokenMessageInfo } from "../app/lib/tokenMessageInfo";
import { isStandaloneCashuTokenMessage } from "../app/lib/tokenText";
import { deriveDefaultProfile } from "../derivedProfile";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";
import { Avatar } from "./Avatar";
import { CashuTokenPill } from "./CashuTokenPill";
import type { NpubMessageContactInfo } from "./ChatMessage";

const ENTITY_PATTERN =
  /(?:nostr:)?npub1[023456789acdefghjklmnpqrstuvwxyz]+(?:@npub\.cash)?|cashu[0-9A-Za-z_-]+={0,2}/gi;

interface MessageEntityPreviewProps {
  className?: string;
  content: string;
  directionSymbol?: string;
  getCashuTokenMessageInfo: (text: string) => CashuTokenMessageInfo | null;
  getMintIconUrl: (mint: string | null | undefined) => {
    url: string | null;
  };
  getNpubMessageContactInfo: (npub: string) => NpubMessageContactInfo | null;
  onOpenNpubContact?: (npub: string) => void;
}

export const MessageEntityPreview: React.FC<MessageEntityPreviewProps> = ({
  className,
  content,
  directionSymbol,
  getCashuTokenMessageInfo,
  getMintIconUrl,
  getNpubMessageContactInfo,
  onOpenNpubContact,
}) => {
  const { formatDisplayedAmountText } = useAppShellCore();
  const standaloneTokenInfo = isStandaloneCashuTokenMessage(content)
    ? getCashuTokenMessageInfo(content)
    : null;
  const matches = Array.from(content.matchAll(ENTITY_PATTERN));
  const segments: React.ReactNode[] = [];
  let cursor = 0;

  if (directionSymbol) segments.push(`${directionSymbol} `);

  if (standaloneTokenInfo) {
    const icon = getMintIconUrl(standaloneTokenInfo.mintUrl);
    segments.push(
      <CashuTokenPill
        key="standalone-cashu"
        className="chat-token-pill"
        icon={icon}
        amountText={formatDisplayedAmountText(standaloneTokenInfo.amount ?? 0)}
        isMuted={!standaloneTokenInfo.isValid}
      />,
    );
  }

  for (const match of standaloneTokenInfo ? [] : matches) {
    const text = match[0];
    const start = match.index ?? 0;
    if (start > cursor) segments.push(content.slice(cursor, start));

    const isCashuToken = text.toLowerCase().startsWith("cashu");
    const npub = isCashuToken ? null : normalizeNpubIdentifier(text);
    const contactInfo = npub ? getNpubMessageContactInfo(npub) : null;
    const tokenInfo = isCashuToken ? getCashuTokenMessageInfo(text) : null;

    if (contactInfo) {
      const avatar = contactInfo.pictureUrl;
      const label = contactInfo.displayName;
      const pillContent = (
        <>
          <span className="chat-contact-pill-avatar" aria-hidden="true">
            <Avatar
              pictureUrl={avatar}
              fallback={deriveDefaultProfile(contactInfo.npub).name.charAt(0)}
              fallbackClassName="chat-contact-pill-avatar-fallback"
              loading="lazy"
            />
          </span>
          <span className="chat-contact-pill-label">{label}</span>
        </>
      );
      segments.push(
        onOpenNpubContact ? (
          <button
            key={`${start}-npub`}
            type="button"
            className="pill chat-contact-pill"
            onClick={() => onOpenNpubContact(contactInfo.npub)}
          >
            {pillContent}
          </button>
        ) : (
          <span key={`${start}-npub`} className="pill chat-contact-pill">
            {pillContent}
          </span>
        ),
      );
    } else if (tokenInfo) {
      const icon = getMintIconUrl(tokenInfo.mintUrl);
      segments.push(
        <CashuTokenPill
          key={`${start}-cashu`}
          className="chat-token-pill"
          icon={icon}
          amountText={formatDisplayedAmountText(tokenInfo.amount ?? 0)}
          isMuted={!tokenInfo.isValid}
        />,
      );
    } else {
      segments.push(text);
    }
    cursor = start + text.length;
  }

  if (!standaloneTokenInfo && cursor < content.length) {
    segments.push(content.slice(cursor));
  }

  return <div className={className}>{segments}</div>;
};
