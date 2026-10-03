import { Stack } from "@linky-fit/ui";
import React from "react";
import { ContactsChecklist } from "../../components/ContactsChecklist";
import {
  FloatingActionButton,
  floatingActionButtonClearance,
} from "../../components/FloatingActionButton";
import type { Translate } from "../../i18n";
import { ContactsPage } from "../../pages/ContactsPage";
import { WalletPage } from "../../pages/WalletPage";
import type { Route } from "../../types/route";
import { nowSeconds } from "../../utils/time";
import { useMainTabRoutes } from "../context/AppShellContexts";
import type { ContactRowLike, ContactsGuideKey } from "../types/appTypes";

type ActiveBankPaymentOfferContacts = (nowSec: number) => {
  contactIds: ReadonlySet<string>;
  nextExpiryAtSec: number | null;
};

export interface MainTabRouteProps {
  activeGroup: string | null;
  cashuTotalBalance: number;
  activeBankPaymentOfferContacts: ActiveBankPaymentOfferContacts;
  contactsOnboardingCelebrating: boolean;
  contactsOnboardingTasks: {
    done: number;
    percent: number;
    tasks: ReadonlyArray<{ done: boolean; key: string; label: string }>;
    total: number;
  };
  contactsFilterOpen: boolean;
  contactsSearch: string;
  contactsSearchInputRef: React.RefObject<HTMLInputElement | null>;
  contactFilterOptions: Array<{ count: number; label: string; value: string }>;
  conversationsLabel: string;
  dismissContactsOnboarding: () => void;
  openNewContactPage: () => void;
  openWalletScan: () => void;
  otherContactsLabel: string;
  renderContactCard: (contact: ContactRowLike) => React.ReactNode;
  route: Route;
  scanIsOpen: boolean;
  setActiveGroup: (group: string | null) => void;
  setContactsSearch: (value: string) => void;
  showContactsOnboarding: boolean;
  showWalletWarning: boolean;
  showGroupFilter: boolean;
  startContactsGuide: (task: ContactsGuideKey) => void;
  t: Translate;
  visibleContacts: {
    conversations: ContactRowLike[];
    others: ContactRowLike[];
    pinned: ContactRowLike[];
  };
  dismissWalletWarning: () => void;
}

const isContactsGuideKey = (value: string): value is ContactsGuideKey =>
  value === "add_contact" ||
  value === "topup" ||
  value === "pay" ||
  value === "message" ||
  value === "backup_keys";

interface VisibleContactSections {
  conversations: ContactRowLike[];
  others: ContactRowLike[];
  pinned: ContactRowLike[];
  proxyPayments: ContactRowLike[];
}

const useVisibleContactSections = (
  activeBankPaymentOfferContacts: ActiveBankPaymentOfferContacts,
  visibleContacts: MainTabRouteProps["visibleContacts"],
): VisibleContactSections => {
  const [nowSec, setNowSec] = React.useState(() => nowSeconds());
  const activeOffers = React.useMemo(
    () => activeBankPaymentOfferContacts(nowSec),
    [activeBankPaymentOfferContacts, nowSec],
  );

  React.useEffect(() => {
    if (activeOffers.nextExpiryAtSec === null) return;
    const timeoutId = window.setTimeout(
      () => setNowSec(nowSeconds()),
      Math.max(0, activeOffers.nextExpiryAtSec * 1_000 - Date.now() + 25),
    );
    return () => window.clearTimeout(timeoutId);
  }, [activeOffers.nextExpiryAtSec]);

  return React.useMemo(() => {
    const isProxyPaymentContact = (contact: ContactRowLike): boolean =>
      contact.isUnknownContact !== true &&
      activeOffers.contactIds.has((contact.id ?? "").trim());
    const proxyPayments = [
      ...visibleContacts.pinned,
      ...visibleContacts.conversations,
      ...visibleContacts.others,
    ].filter(isProxyPaymentContact);

    return {
      conversations: visibleContacts.conversations.filter(
        (contact) => !isProxyPaymentContact(contact),
      ),
      others: visibleContacts.others.filter(
        (contact) => !isProxyPaymentContact(contact),
      ),
      pinned: visibleContacts.pinned.filter(
        (contact) => !isProxyPaymentContact(contact),
      ),
      proxyPayments,
    };
  }, [activeOffers.contactIds, visibleContacts]);
};

const ContactsContent = ({
  filterAlwaysOpen,
}: {
  filterAlwaysOpen: boolean;
}): React.ReactElement => {
  const { mainTabProps } = useMainTabRoutes();
  const {
    activeBankPaymentOfferContacts,
    activeGroup,
    contactsOnboardingCelebrating,
    contactsOnboardingTasks,
    contactsFilterOpen,
    contactsSearch,
    contactsSearchInputRef,
    contactFilterOptions,
    conversationsLabel,
    dismissContactsOnboarding,
    otherContactsLabel,
    renderContactCard,
    setActiveGroup,
    setContactsSearch,
    showContactsOnboarding,
    showGroupFilter,
    startContactsGuide,
    t,
    visibleContacts,
  } = mainTabProps;
  const visibleContactSections = useVisibleContactSections(
    activeBankPaymentOfferContacts,
    visibleContacts,
  );

  return (
    <ContactsPage
      onboardingContent={
        showContactsOnboarding ? (
          <ContactsChecklist
            contactsOnboardingCelebrating={contactsOnboardingCelebrating}
            dismissContactsOnboarding={dismissContactsOnboarding}
            onShowHow={(key) => {
              if (!isContactsGuideKey(key)) return;
              startContactsGuide(key);
            }}
            progressPercent={contactsOnboardingTasks.percent}
            t={t}
            tasks={contactsOnboardingTasks.tasks}
            tasksCompleted={contactsOnboardingTasks.done}
            tasksTotal={contactsOnboardingTasks.total}
          />
        ) : null
      }
      contactsSearchInputRef={contactsSearchInputRef}
      contactsSearch={contactsSearch}
      filterOpen={contactsFilterOpen || filterAlwaysOpen}
      setContactsSearch={setContactsSearch}
      showGroupFilter={
        showGroupFilter || (filterAlwaysOpen && contactFilterOptions.length > 0)
      }
      activeGroup={activeGroup}
      setActiveGroup={setActiveGroup}
      filterOptions={contactFilterOptions}
      visibleContacts={visibleContactSections}
      conversationsLabel={conversationsLabel}
      otherContactsLabel={otherContactsLabel}
      renderContactCard={renderContactCard}
      t={t}
    />
  );
};

const AddContactButton = (): React.ReactElement => {
  const { mainTabProps } = useMainTabRoutes();
  return (
    <FloatingActionButton
      icon="UserPlus"
      label={mainTabProps.t("addContact")}
      onPress={mainTabProps.openNewContactPage}
      guide="contact-add-button"
    />
  );
};

export const ContactsPane = (): React.ReactElement => (
  <>
    <Stack paddingBottom={floatingActionButtonClearance}>
      <ContactsContent filterAlwaysOpen={false} />
    </Stack>
    <AddContactButton />
  </>
);

export const DesktopContactsPane = (): React.ReactElement => (
  <>
    <ContactsContent filterAlwaysOpen />
    <AddContactButton />
  </>
);

export const WalletPane = (): React.ReactElement => {
  const { mainTabProps } = useMainTabRoutes();
  const {
    cashuTotalBalance,
    dismissWalletWarning,
    openWalletScan,
    scanIsOpen,
    showWalletWarning,
    t,
  } = mainTabProps;

  return (
    <WalletPage
      cashuTotalBalance={cashuTotalBalance}
      openScan={openWalletScan}
      scanIsOpen={scanIsOpen}
      dismissWalletWarning={dismissWalletWarning}
      showWalletWarning={showWalletWarning}
      t={t}
    />
  );
};
