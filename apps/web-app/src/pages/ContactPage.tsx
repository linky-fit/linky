import {
  ArchiveRestore,
  HeartHandshake as DonateIcon,
  MessageCircle as FeedbackIcon,
  MessageCircleMore as MessagesIcon,
  HandCoins as PayIcon,
} from "lucide-react";
import { useEffect, useState, type FC } from "react";
import { Avatar } from "../components/Avatar";

import type { ContactId } from "../evolu";
import { navigateTo } from "../hooks/useRouting";
import type { Translate } from "../i18n";
import { formatDisplayGeneralStatus } from "../nostrStatus";
import { loadCachedProfile } from "../profileCache";
import { getContactGroups } from "../utils/contactGroups";
import { formatShortLightningAddress, getInitials } from "../utils/formatting";
import { resolveVerifiedNip05Identifier } from "../utils/nostrNip05";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";

interface Contact {
  archivedAtSec?: number | string | null;
  id: ContactId;
  name?: string | null;
  groupName?: string | null;
  groupNamesJson?: string | null;
  lnAddress?: string | null;
  npub?: string | null;
}

interface ContactPageProps {
  cashuBalance: number;
  cashuIsBusy: boolean;
  copyText: (text: string) => Promise<void>;
  feedbackContactNpub: string;
  nostrPictureByNpub: Record<string, string | null>;
  openContactPay: (id: ContactId) => void;
  payWithCashuEnabled: boolean;
  restoreArchivedContact: () => void;
  selectedContact: Contact | null;
  statusText: string | null;
  t: Translate;
}

interface ContactActionButtonProps {
  children: string;
  className?: string;
  dataGuide?: string;
  disabled?: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  title?: string | undefined;
}

const ContactActionButton = ({
  children,
  className = "btn-wide",
  dataGuide,
  disabled = false,
  icon,
  onClick,
  title,
}: ContactActionButtonProps): React.ReactElement => {
  return (
    <button
      className={className}
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-guide={dataGuide}
    >
      <span className="btn-label-with-icon">
        <span className="btn-label-icon" aria-hidden="true">
          {icon}
        </span>
        <span>{children}</span>
      </span>
    </button>
  );
};

const useVerifiedNip05 = (npub: string | null): string | null => {
  const [verifiedNip05, setVerifiedNip05] = useState<{
    identifier: string;
    npub: string;
  } | null>(null);

  useEffect(() => {
    if (!npub) return;

    // Contact pubkeys are watched, so the cached profile is authoritative.
    const nip05 = loadCachedProfile(npub)?.metadata.nip05;
    if (!nip05) return;

    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      try {
        const identifier = await resolveVerifiedNip05Identifier(nip05, npub, {
          signal: controller.signal,
        });
        if (!cancelled && identifier) setVerifiedNip05({ identifier, npub });
      } catch {
        // A profile remains usable when its NIP-05 server is offline.
      }
    };

    void load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [npub]);

  return verifiedNip05?.npub === npub ? verifiedNip05.identifier : null;
};

export const ContactPage: FC<ContactPageProps> = ({
  cashuBalance,
  cashuIsBusy,
  copyText,
  feedbackContactNpub,
  nostrPictureByNpub,
  openContactPay,
  payWithCashuEnabled,
  restoreArchivedContact,
  selectedContact,
  statusText,
  t,
}) => {
  const selectedNpub = normalizeNpubIdentifier(selectedContact?.npub ?? "");
  const selectedLnAddress = (selectedContact?.lnAddress ?? "").trim();
  const verifiedNip05 = useVerifiedNip05(
    selectedLnAddress ? selectedNpub : null,
  );
  if (!selectedContact) {
    return (
      <section className="panel">
        <p className="muted">{t("contactNotFound")}</p>
      </section>
    );
  }

  const contactId = selectedContact.id;
  const name = (selectedContact.name ?? "").trim();
  const groups = getContactGroups(selectedContact);
  const ln = selectedLnAddress;
  const npub = selectedNpub;
  const url = npub ? nostrPictureByNpub[npub] : null;
  const hasLightningAddress = ln.length > 0;
  const canMessage = Boolean(npub);
  const contactName = name || t("contact");
  const isLightningAddressNip05Verified =
    Boolean(verifiedNip05) && verifiedNip05?.toLowerCase() === ln.toLowerCase();
  const canPayThisContact =
    hasLightningAddress || (payWithCashuEnabled && canMessage);
  const canStartPay = cashuBalance > 0 && canPayThisContact;
  const isFeedbackContact = npub === feedbackContactNpub;
  const isArchivedContact = Number(selectedContact.archivedAtSec ?? 0) > 0;
  const payLabel = isFeedbackContact ? t("donate") : t("pay");
  const messageLabel = isFeedbackContact ? t("feedback") : t("sendMessage");
  const contactStatus = formatDisplayGeneralStatus({
    status: statusText,
    providesLabel: t("contactStatusProvides"),
  });
  const avatarContent = (
    <Avatar
      pictureUrl={url}
      fallback={getInitials(selectedContact.name ?? "")}
      fallbackClassName="contact-avatar-fallback"
      loading="lazy"
    />
  );

  return (
    <section className="panel contact-detail-card">
      <div className="contact-detail">
        <div className="contact-detail-header">
          {npub ? (
            <button
              type="button"
              className="contact-avatar is-xl contact-detail-avatar-button"
              onClick={() => void copyText(npub)}
              aria-label={`${t("copy")} ${t("npub")}`}
              title={npub}
            >
              {avatarContent}
            </button>
          ) : (
            <div className="contact-avatar is-xl" aria-hidden="true">
              {avatarContent}
            </div>
          )}
        </div>

        <div className="contact-detail-copy-block">
          <div className="contact-detail-title-row">
            <h2 className="contact-detail-name" title={contactName}>
              {contactName}
            </h2>
          </div>
          {contactStatus ? (
            <p className="contact-detail-status" title={contactStatus}>
              {contactStatus}
            </p>
          ) : null}
          {isArchivedContact ? (
            <span className="contact-detail-archived-badge">
              {t("archivedContactBadge")}
            </span>
          ) : null}
          {groups.length > 0 ? (
            <div className="contact-group-pills contact-detail-groups">
              {groups.map((group) => (
                <span
                  className="group-filter-btn contact-group-pill"
                  key={group}
                >
                  {group}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {hasLightningAddress ? (
          <button
            type="button"
            className="copyable contact-detail-ln contact-detail-copy"
            onClick={() => void copyText(ln)}
            title={
              isLightningAddressNip05Verified
                ? `${ln} · ${t("verifiedNip05")}`
                : ln
            }
            aria-label={
              isLightningAddressNip05Verified
                ? `${t("verifiedNip05")}: ${ln}`
                : t("lightningAddress")
            }
          >
            {isLightningAddressNip05Verified ? (
              <span className="contact-detail-nip05-check" aria-hidden="true">
                ✓
              </span>
            ) : null}
            {formatShortLightningAddress(ln)}
          </button>
        ) : null}

        {isArchivedContact ? (
          <ContactActionButton
            className="btn-wide secondary"
            icon={<ArchiveRestore size={18} />}
            onClick={restoreArchivedContact}
          >
            {t("restoreArchivedContact")}
          </ContactActionButton>
        ) : null}

        {canPayThisContact && (
          <ContactActionButton
            icon={
              isFeedbackContact ? (
                <DonateIcon size={18} />
              ) : (
                <PayIcon size={18} />
              )
            }
            onClick={() => openContactPay(contactId)}
            disabled={cashuIsBusy || !canStartPay}
            title={!canStartPay ? t("payInsufficient") : undefined}
            dataGuide="contact-pay"
          >
            {payLabel}
          </ContactActionButton>
        )}

        {canMessage && (
          <ContactActionButton
            className="btn-wide secondary"
            icon={
              isFeedbackContact ? (
                <FeedbackIcon size={18} />
              ) : (
                <MessagesIcon size={18} />
              )
            }
            onClick={() => navigateTo({ route: "chat", id: contactId })}
            dataGuide="contact-message"
          >
            {messageLabel}
          </ContactActionButton>
        )}
      </div>
    </section>
  );
};
