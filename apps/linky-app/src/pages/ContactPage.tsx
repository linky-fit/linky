import {
  Avatar,
  Button,
  EmptyState,
  OptionTile,
  Pill,
  Row,
  Stack,
  Text,
} from "@linky-fit/ui";
import { useMemo, type FC } from "react";
import { useAtomValue } from "@linky-fit/linkstr-react";
import { useOpenContactPay } from "../app/hooks/contacts/useContactActions";
import {
  useNostrStatusByNpub,
  useProxyPaymentCurrenciesOf,
  useRoutePeopleContact,
} from "../app/hooks/contacts/useDisplayContacts";
import { useNostrPictureByNpub } from "../app/hooks/contacts/useProfileCache";
import { useCopyText, useTranslation } from "../app/hooks/shell";
import { useWalletBalance } from "../app/hooks/wallet/useWalletInventory";
import { payWithCashuEnabledAtom } from "../app/state/wallet/prefs";
import type { Route } from "../types/route";
import { FEEDBACK_CONTACT_NPUB } from "../utils/constants";

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
import { useVerifiedNip05 } from "../app/hooks/contacts/useVerifiedNip05";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";
import { contactPictureUrl } from "../derivedProfile";

interface Contact {
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
  selectedContact: Contact | null;
  statusText: string | null;
  /** What the contact offers as proxy payments. */
  proxyPaymentCurrencies: ReadonlyArray<string>;
  t: Translate;
}

export const ContactPage: FC<ContactPageProps> = ({
  cashuBalance,
  cashuIsBusy,
  copyText,
  feedbackContactNpub,
  nostrPictureByNpub,
  openContactPay,
  payWithCashuEnabled,
  selectedContact,
  statusText,
  proxyPaymentCurrencies,
  t,
}) => {
  const selectedNpub = normalizeNpubIdentifier(selectedContact?.npub ?? "");
  const selectedLnAddress = (selectedContact?.lnAddress ?? "").trim();
  const verifiedNip05Npub = selectedLnAddress ? selectedNpub : null;
  // Contact pubkeys are watched, so the cached profile is authoritative.
  const claimedNip05 = useMemo(
    () =>
      verifiedNip05Npub
        ? loadCachedProfile(verifiedNip05Npub)?.metadata.nip05
        : null,
    [verifiedNip05Npub],
  );
  const verifiedNip05 = useVerifiedNip05(verifiedNip05Npub, claimedNip05);
  if (!selectedContact) {
    return <EmptyState title={t("contactNotFound")} />;
  }

  const contactId = selectedContact.id;
  const name = (selectedContact.name ?? "").trim();
  const groups = getContactGroups(selectedContact);
  const ln = selectedLnAddress;
  const npub = selectedNpub;
  const url = contactPictureUrl(npub, nostrPictureByNpub);
  const hasLightningAddress = ln.length > 0;
  const canMessage = Boolean(npub);
  const contactName = name || t("contact");
  const isLightningAddressNip05Verified =
    Boolean(verifiedNip05) && verifiedNip05?.toLowerCase() === ln.toLowerCase();
  const canPayThisContact =
    hasLightningAddress || (payWithCashuEnabled && canMessage);
  const canStartPay = cashuBalance > 0 && canPayThisContact;
  const isFeedbackContact = npub === feedbackContactNpub;
  const payLabel = isFeedbackContact ? t("donate") : t("pay");
  const messageLabel = isFeedbackContact ? t("feedback") : t("sendMessage");
  const contactStatus = formatDisplayGeneralStatus({
    status: statusText,
    currencies: proxyPaymentCurrencies,
    providesLabel: t("contactStatusProvides"),
  });
  return (
    <Stack gap="$md">
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
            icon={isLightningAddressNip05Verified ? "Check" : "Zap"}
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

      {canPayThisContact || canMessage ? (
        <Row gap="$sm" alignItems="stretch" marginTop="$sm">
          {canMessage ? (
            <OptionTile
              flex={1}
              icon={isFeedbackContact ? "MessageCircle" : "MessageCircleMore"}
              label={messageLabel}
              onPress={() => navigateTo({ route: "chat", id: contactId })}
              data-guide="contact-message"
            />
          ) : null}
          {canPayThisContact ? (
            <OptionTile
              flex={1}
              icon={isFeedbackContact ? "HeartHandshake" : "HandCoins"}
              label={payLabel}
              backgroundColor="$accentSoft"
              onPress={() => openContactPay(contactId)}
              disabled={cashuIsBusy || !canStartPay}
              tooltip={!canStartPay ? t("payInsufficient") : undefined}
              data-guide="contact-pay"
            />
          ) : null}
        </Row>
      ) : null}
    </Stack>
  );
};

export const ContactRoute: FC<{ route: Route }> = ({ route }) => {
  const { t } = useTranslation();
  const copyText = useCopyText();
  const selectedContact = useRoutePeopleContact(route);
  const nostrPictureByNpub = useNostrPictureByNpub();
  const statusByNpub = useNostrStatusByNpub();
  const proxyPaymentCurrenciesOf = useProxyPaymentCurrenciesOf();
  const { cashuBalance, cashuIsBusy } = useWalletBalance();
  const payWithCashuEnabled = useAtomValue(payWithCashuEnabledAtom);
  const openContactPay = useOpenContactPay();
  const npub = normalizeNpubIdentifier(selectedContact?.npub ?? "");
  return (
    <ContactPage
      cashuBalance={cashuBalance}
      cashuIsBusy={cashuIsBusy}
      copyText={copyText}
      feedbackContactNpub={FEEDBACK_CONTACT_NPUB}
      nostrPictureByNpub={nostrPictureByNpub}
      openContactPay={openContactPay}
      payWithCashuEnabled={payWithCashuEnabled}
      selectedContact={selectedContact}
      statusText={npub ? (statusByNpub[npub] ?? null) : null}
      proxyPaymentCurrencies={npub ? proxyPaymentCurrenciesOf(npub) : []}
      t={t}
    />
  );
};
