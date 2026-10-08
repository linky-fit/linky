import { encodeNpub } from "@linky-fit/linkstr";
import {
  Chip,
  EmptyState,
  IconButton,
  NearbyAvatar,
  NearbyRow,
  Row,
  ScrollList,
  ScrollView,
  Section,
  Stack,
  TextField,
  useMedia,
} from "@linky-fit/ui";
import type { FC } from "react";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import {
  useBeacon,
  useBeaconSupport,
  useNearbyContacts,
} from "../app/hooks/useBeacon";
import { useContactRows } from "../app/hooks/useLinksync";
import type { ContactRowLike } from "../app/types/appTypes";
import { navigateTo } from "../hooks/useRouting";
import type { Translate } from "../i18n";
import { formatShortNpub } from "../utils/formatting";

interface ContactsPageProps {
  activeGroup: string | null;
  contactsSearch: string;
  contactsSearchInputRef: React.RefObject<HTMLInputElement | null>;
  conversationsLabel: string;
  filterOpen: boolean;
  filterOptions: Array<{ count: number; label: string; value: string }>;
  onboardingContent?: React.ReactNode;
  otherContactsLabel: string;
  renderContactCard: (contact: ContactRowLike) => React.ReactNode;
  setActiveGroup: (value: string | null) => void;
  setContactsSearch: (value: string) => void;
  showGroupFilter: boolean;
  t: Translate;
  visibleContacts: {
    conversations: ContactRowLike[];
    others: ContactRowLike[];
    pinned: ContactRowLike[];
    proxyPayments: ContactRowLike[];
  };
}

const TRADE_BADGE_KEYS = {
  buy: "beaconTradeBuy",
  sell: "beaconTradeSell",
} as const;

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** The user (while their own trade is published) and nearby contacts, trades first. */
function NearbyContactsSection({ t }: { t: Translate }) {
  const { trade } = useBeacon();
  const nearby = useNearbyContacts();
  const contactRows = useContactRows();
  const { effectiveProfileName, effectiveProfilePicture, nostrPictureByNpub } =
    useAppShellCore();

  if (nearby.length === 0 && trade === "none") return null;

  const badge = (state: "nearby" | "buy" | "sell") =>
    state === "nearby"
      ? {}
      : { trade: state, badgeLabel: t(TRADE_BADGE_KEYS[state]) };

  return (
    <Section title={t("nearby")}>
      <NearbyRow accessibilityLabel={t("nearby")}>
        {trade === "none" ? null : (
          <NearbyAvatar
            name={effectiveProfileName ?? ""}
            imageUrl={effectiveProfilePicture ?? undefined}
            label={t("nearbyYou")}
            isSelf
            onPress={() => navigateTo({ route: "proxyPayments" })}
            {...badge(trade)}
          />
        )}
        {nearby.map(({ pubkey, contactId, state }) => {
          const npub = encodeNpub(pubkey);
          const row = contactRows.find(({ id }) => id === contactId);
          const name = row?.name ?? formatShortNpub(npub);
          return (
            <NearbyAvatar
              key={pubkey}
              name={name}
              imageUrl={nostrPictureByNpub[npub] ?? undefined}
              label={firstName(name)}
              onPress={() => navigateTo({ route: "chat", id: contactId })}
              {...badge(state)}
            />
          );
        })}
      </NearbyRow>
    </Section>
  );
}

export const ContactsPage: FC<ContactsPageProps> = React.memo(
  ({
    activeGroup,
    contactsSearch,
    contactsSearchInputRef,
    conversationsLabel,
    filterOpen,
    filterOptions,
    onboardingContent,
    otherContactsLabel,
    renderContactCard,
    setActiveGroup,
    setContactsSearch,
    showGroupFilter,
    t,
    visibleContacts,
  }) => {
    const { wide } = useMedia();
    const beaconSupported = useBeaconSupport();
    const ContactList = wide ? ScrollList : Stack;
    const totalVisible =
      visibleContacts.pinned.length +
      visibleContacts.proxyPayments.length +
      visibleContacts.conversations.length +
      visibleContacts.others.length;
    const hasAnyContacts = totalVisible > 0;
    const renderSection = (title: string, contacts: ContactRowLike[]) =>
      contacts.length > 0 ? (
        <Section title={title}>
          <Stack gap="$xs">{contacts.map(renderContactCard)}</Stack>
        </Section>
      ) : null;

    return (
      <>
        {onboardingContent}
        {filterOpen && (
          <Stack
            position="sticky"
            top="$none"
            zIndex="$sticky"
            gap="$sm"
            paddingVertical="$xs"
            backgroundColor="$background"
          >
            <TextField
              ref={(node) => {
                contactsSearchInputRef.current =
                  node instanceof HTMLInputElement ? node : null;
              }}
              label={t("contactsSearchPlaceholder")}
              hideLabel
              placeholder={t("contactsSearchPlaceholder")}
              value={contactsSearch}
              onChange={(event) => setContactsSearch(event.target.value)}
              autoComplete="off"
              enterKeyHint="search"
              trailing={
                contactsSearch.trim() ? (
                  <IconButton
                    icon="X"
                    size="sm"
                    variant="secondary"
                    accessibilityLabel={t("contactsSearchClear")}
                    onPointerDown={(event) => event.preventDefault()}
                    onPress={() => {
                      setContactsSearch("");
                      requestAnimationFrame(() => {
                        contactsSearchInputRef.current?.focus();
                      });
                    }}
                  />
                ) : null
              }
            />

            {showGroupFilter && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                role="navigation"
                aria-label={t("group")}
              >
                <Row gap="$sm" paddingVertical="$xs">
                  {filterOptions.map((option) => (
                    <Chip
                      key={option.value}
                      label={option.label}
                      selected={activeGroup === option.value}
                      onPress={() =>
                        setActiveGroup(
                          activeGroup === option.value ? null : option.value,
                        )
                      }
                    />
                  ))}
                </Row>
              </ScrollView>
            )}
          </Stack>
        )}

        <ContactList flex={wide ? 1 : undefined}>
          <Stack gap="$xs">
            {beaconSupported ? <NearbyContactsSection t={t} /> : null}
            {!hasAnyContacts ? (
              <EmptyState title={t("noContactsYet")} />
            ) : (
              <>
                {visibleContacts.pinned.length > 0 && (
                  <Stack gap="$xs">
                    {visibleContacts.pinned.map(renderContactCard)}
                  </Stack>
                )}
                {renderSection(
                  t("proxyPayments"),
                  visibleContacts.proxyPayments,
                )}
                {renderSection(
                  conversationsLabel,
                  visibleContacts.conversations,
                )}
                {renderSection(otherContactsLabel, visibleContacts.others)}
              </>
            )}
          </Stack>
        </ContactList>
      </>
    );
  },
);
