import {
  Avatar,
  Button,
  EmptyState,
  Pill,
  Row,
  Stack,
  Text,
} from "@linky-fit/ui";
import { useEffect, useState, type FC } from "react";

import type { ContactId } from "../evolu";
import { navigateTo } from "../hooks/useRouting";
import type { Translate } from "../i18n";
import { formatDisplayGeneralStatus } from "../nostrStatus";
import { loadCachedProfile } from "../profileCache";
import { getContactGroups } from "../utils/contactGroups";
import {
  formatShortLightningAddress,
  formatShortNpub,
} from "../utils/formatting";
import { resolveVerifiedNip05Identifier } from "../utils/nostrNip05";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";
import { PageCard } from "../components/PageCard";

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
  /** Opens the donate screen; null while Donate pays the Linky contact. */
  openDonate: (() => void) | null;
  payWithCashuEnabled: boolean;
  restoreArchivedContact: () => void;
  selectedContact: Contact | null;
  statusText: string | null;
  t: Translate;
}

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
  openDonate,
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
    return <EmptyState title={t("contactNotFound")} />;
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
  const donate = isFeedbackContact ? openDonate : null;
  const isArchivedContact = Number(selectedContact.archivedAtSec ?? 0) > 0;
  const payLabel = isFeedbackContact ? t("donate") : t("pay");
  const messageLabel = isFeedbackContact ? t("feedback") : t("sendMessage");
  const contactStatus = formatDisplayGeneralStatus({
    status: statusText,
    providesLabel: t("contactStatusProvides"),
  });
  return (
    <PageCard elevated>
      <Stack alignItems="center" gap="$sm">
        <Avatar name={name} uri={url ?? undefined} size="lg" />
        <Text variant="display" textAlign="center" numberOfLines={2}>
          {contactName}
        </Text>
        {contactStatus ? (
          <Text variant="label" color="$colorMuted" textAlign="center">
            {contactStatus}
          </Text>
        ) : null}
        {isArchivedContact ? (
          <Pill size="sm" label={t("archivedContactBadge")} tone="neutral" />
        ) : null}
        {groups.length > 0 ? (
          <Row gap="$sm" flexWrap="wrap" justifyContent="center">
            {groups.map((group) => (
              <Pill key={group} label={group} tone="neutral" />
            ))}
          </Row>
        ) : null}
        {hasLightningAddress ? (
          <Button
            variant="ghost"
            size="sm"
            icon={isLightningAddressNip05Verified ? "Check" : "Copy"}
            onPress={() => void copyText(ln)}
            aria-label={
              isLightningAddressNip05Verified
                ? `${t("verifiedNip05")}: ${ln}`
                : t("lightningAddress")
            }
          >
            {formatShortLightningAddress(ln)}
          </Button>
        ) : null}
        {npub ? (
          <Button
            variant="ghost"
            size="sm"
            icon="Copy"
            onPress={() => void copyText(npub)}
            aria-label={`${t("copy")} ${t("npub")}`}
          >
            {formatShortNpub(npub)}
          </Button>
        ) : null}
      </Stack>

      {isArchivedContact ? (
        <Button
          variant="secondary"
          icon="ArchiveRestore"
          onPress={restoreArchivedContact}
        >
          {t("restoreArchivedContact")}
        </Button>
      ) : null}

      {donate ? (
        <Button icon="HeartHandshake" onPress={donate}>
          {payLabel}
        </Button>
      ) : canPayThisContact ? (
        <Button
          icon={isFeedbackContact ? "HeartHandshake" : "HandCoins"}
          onPress={() => openContactPay(contactId)}
          disabled={cashuIsBusy || !canStartPay}
          tooltip={!canStartPay ? t("payInsufficient") : undefined}
          data-guide="contact-pay"
        >
          {payLabel}
        </Button>
      ) : null}

      {canMessage && (
        <Button
          variant="secondary"
          icon={isFeedbackContact ? "MessageCircle" : "MessageCircleMore"}
          onPress={() => navigateTo({ route: "chat", id: contactId })}
          data-guide="contact-message"
        >
          {messageLabel}
        </Button>
      )}
    </PageCard>
  );
};
