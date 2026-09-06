import { UserPlus as ContactAddIcon } from "lucide-react";
import type { FC } from "react";
import React from "react";
import type { ContactRowLike } from "../app/types/appTypes";
import { BottomTabBar } from "../components/BottomTabBar";

import type { Translate } from "../i18n";

interface ContactsPageProps {
  activeGroup: string | null;
  bottomTabActive: "contacts" | "wallet" | null;
  canAddContact?: boolean;
  contactsSearch: string;
  contactsSearchInputRef: React.RefObject<HTMLInputElement | null>;
  conversationsLabel: string;
  filterOptions: Array<{ count: number; label: string; value: string }>;
  openNewContactPage: () => void;
  onboardingContent?: React.ReactNode;
  otherContactsLabel: string;
  renderContactCard: (contact: ContactRowLike) => React.ReactNode;
  setActiveGroup: (value: string | null) => void;
  setContactsSearch: (value: string) => void;
  showGroupFilter: boolean;
  showBottomTabBar?: boolean;
  showFab?: boolean;
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
    bottomTabActive,
    canAddContact = true,
    contactsSearch,
    contactsSearchInputRef,
    conversationsLabel,
    filterOptions,
    openNewContactPage,
    onboardingContent,
    otherContactsLabel,
    renderContactCard,
    setActiveGroup,
    setContactsSearch,
    showGroupFilter,
    showBottomTabBar = true,
    showFab = true,
    t,
    visibleContacts,
  }) => {
    const totalVisible =
      visibleContacts.pinned.length +
      visibleContacts.proxyPayments.length +
      visibleContacts.conversations.length +
      visibleContacts.others.length;
    const hasAnyContacts = totalVisible > 0;

    return (
      <>
        {onboardingContent}
        <div className="contacts-toolbar">
          <div className="contacts-search-bar" role="search">
            <input
              ref={contactsSearchInputRef}
              type="search"
              placeholder={t("contactsSearchPlaceholder")}
              value={contactsSearch}
              onChange={(e) => setContactsSearch(e.target.value)}
              autoComplete="off"
            />
            {contactsSearch.trim() && (
              <button
                type="button"
                className="contacts-search-clear"
                aria-label={t("contactsSearchClear")}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  setContactsSearch("");
                  requestAnimationFrame(() => {
                    contactsSearchInputRef.current?.focus();
                  });
                }}
              >
                ×
              </button>
            )}
          </div>

          {showGroupFilter && (
            <nav className="group-filter-bar" aria-label={t("group")}>
              <div className="group-filter-inner">
                {filterOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={
                      activeGroup === option.value
                        ? "group-filter-btn contact-group-pill is-active"
                        : "group-filter-btn contact-group-pill"
                    }
                    onClick={() =>
                      setActiveGroup(
                        activeGroup === option.value ? null : option.value,
                      )
                    }
                    title={option.label}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </nav>
          )}
        </div>

        <section className="panel panel-plain contacts-list-panel">
          <div className="contact-list">
            {!hasAnyContacts ? (
              <p className="muted">{t("noContactsYet")}</p>
            ) : (
              <>
                {visibleContacts.pinned.map(renderContactCard)}

                {visibleContacts.proxyPayments.length > 0 && (
                  <React.Fragment key="proxy-payments">
                    <div className="settings-section-title contact-list-section-title">
                      {t("proxyPayments")}
                    </div>
                    {visibleContacts.proxyPayments.map(renderContactCard)}
                  </React.Fragment>
                )}

                {visibleContacts.conversations.length > 0 && (
                  <React.Fragment key="conversations">
                    <div className="settings-section-title contact-list-section-title">
                      {conversationsLabel}
                    </div>
                    {visibleContacts.conversations.map(renderContactCard)}
                  </React.Fragment>
                )}

                {visibleContacts.others.length > 0 && (
                  <React.Fragment key="others">
                    <div className="settings-section-title contact-list-section-title">
                      {otherContactsLabel}
                    </div>
                    {visibleContacts.others.map(renderContactCard)}
                  </React.Fragment>
                )}
              </>
            )}
          </div>
        </section>

        {showBottomTabBar ? (
          <BottomTabBar
            activeTab={bottomTabActive}
            contactsLabel={t("contactsTitle")}
            t={t}
            walletLabel={t("wallet")}
          />
        ) : null}

        {showFab ? (
          <button
            type="button"
            className={`contacts-fab${canAddContact ? "" : " is-disabled"}`}
            onClick={openNewContactPage}
            aria-disabled={!canAddContact}
            aria-label={t("addContact")}
            title={t("addContact")}
            data-guide="contact-add-button"
          >
            <ContactAddIcon className="contacts-fab-svgIcon" />
          </button>
        ) : null}
      </>
    );
  },
);
