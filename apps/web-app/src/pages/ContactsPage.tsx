import {
  Chip,
  EmptyState,
  IconButton,
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
import type { ContactRowLike } from "../app/types/appTypes";
import type { Translate } from "../i18n";

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
          {!hasAnyContacts ? (
            <EmptyState title={t("noContactsYet")} />
          ) : (
            <Stack gap="$xs">
              {visibleContacts.pinned.length > 0 && (
                <Stack gap="$xs">
                  {visibleContacts.pinned.map(renderContactCard)}
                </Stack>
              )}
              {renderSection(t("proxyPayments"), visibleContacts.proxyPayments)}
              {renderSection(conversationsLabel, visibleContacts.conversations)}
              {renderSection(otherContactsLabel, visibleContacts.others)}
            </Stack>
          )}
        </ContactList>
      </>
    );
  },
);
