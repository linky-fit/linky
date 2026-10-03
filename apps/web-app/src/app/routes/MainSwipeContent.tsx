import { Pager, Stack } from "@linky-fit/ui";
import React from "react";
import { BottomTabBar } from "../../components/BottomTabBar";
import { ContactsChecklist } from "../../components/ContactsChecklist";
import { PageBody } from "../../components/PageBody";
import {
  FloatingActionButton,
  floatingActionButtonClearance,
} from "../../components/FloatingActionButton";
import type { Translate } from "../../i18n";
import { ContactsPage } from "../../pages/ContactsPage";
import { WalletPage } from "../../pages/WalletPage";
import type { Route } from "../../types/route";
import { nowSeconds } from "../../utils/time";
import { useMainSwipeRoutes } from "../context/AppShellContexts";
import { useMainSwipeProgress } from "../lib/mainSwipeProgressStore";
import type { ContactRowLike, ContactsGuideKey } from "../types/appTypes";

type ActiveBankPaymentOfferContacts = (nowSec: number) => {
  contactIds: ReadonlySet<string>;
  nextExpiryAtSec: number | null;
};

export interface MainSwipeRouteProps {
  activeGroup: string | null;
  bottomTabActive: "contacts" | "wallet" | null;
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
  handleMainSwipeTabChange: (target: "contacts" | "wallet") => void;
  mainSwipeRef: React.RefObject<HTMLDivElement | null>;
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
  visibleContacts: MainSwipeRouteProps["visibleContacts"],
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

// Read swipe progress here, so a drag re-renders only the tab bar and the FAB.
interface MainSwipeBottomTabBarProps {
  activeTab: "contacts" | "wallet" | null;
  contactsLabel: string;
  onTabChange: (tab: "contacts" | "wallet") => void;
  t: Translate;
  walletLabel: string;
}

const MainSwipeBottomTabBar = ({
  activeTab,
  contactsLabel,
  onTabChange,
  t,
  walletLabel,
}: MainSwipeBottomTabBarProps): React.ReactElement => {
  const { progress } = useMainSwipeProgress();
  return (
    <BottomTabBar
      activeTab={activeTab}
      activeProgress={progress}
      contactsLabel={contactsLabel}
      onTabChange={onTabChange}
      t={t}
      walletLabel={walletLabel}
    />
  );
};

interface MainSwipeFabProps {
  label: string;
  onPress: () => void;
}

const MainSwipeFab = ({
  label,
  onPress,
}: MainSwipeFabProps): React.ReactElement => {
  const { progress } = useMainSwipeProgress();
  return (
    <FloatingActionButton
      icon="UserPlus"
      label={label}
      onPress={onPress}
      hidden={progress >= 0.5}
      guide="contact-add-button"
    />
  );
};

const ContactsPane = ({
  filterAlwaysOpen,
}: {
  filterAlwaysOpen: boolean;
}): React.ReactElement => {
  const { mainSwipeProps } = useMainSwipeRoutes();
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
  } = mainSwipeProps;
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

const WalletPane = (): React.ReactElement => {
  const { mainSwipeProps } = useMainSwipeRoutes();
  const {
    cashuTotalBalance,
    dismissWalletWarning,
    openWalletScan,
    scanIsOpen,
    showWalletWarning,
    t,
  } = mainSwipeProps;

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

/** Phone: contacts and wallet side by side, swiped between above the tab bar. */
export const MainSwipeContent = (): React.ReactElement => {
  const { mainSwipeProps } = useMainSwipeRoutes();
  const {
    bottomTabActive,
    handleMainSwipeTabChange,
    mainSwipeRef,
    openNewContactPage,
    route,
    t,
  } = mainSwipeProps;

  return (
    <>
      <Stack
        testID="main-swipe"
        flex={1}
        minHeight={0}
        gap="$none"
        position="relative"
      >
        <Pager
          scrollRef={mainSwipeRef}
          activePage={route.kind === "wallet" ? 1 : 0}
        >
          <PageBody
            flex={undefined}
            flexGrow={1}
            paddingBottom={floatingActionButtonClearance}
          >
            <ContactsPane filterAlwaysOpen={false} />
          </PageBody>
          <PageBody>
            <WalletPane />
          </PageBody>
        </Pager>
        <MainSwipeFab label={t("addContact")} onPress={openNewContactPage} />
      </Stack>
      <MainSwipeBottomTabBar
        activeTab={bottomTabActive}
        contactsLabel={t("contactsTitle")}
        onTabChange={handleMainSwipeTabChange}
        t={t}
        walletLabel={t("wallet")}
      />
    </>
  );
};

export const DesktopContactsPane = (): React.ReactElement => {
  const { mainSwipeProps } = useMainSwipeRoutes();
  return (
    <>
      <ContactsPane filterAlwaysOpen />
      <FloatingActionButton
        icon="UserPlus"
        label={mainSwipeProps.t("addContact")}
        onPress={mainSwipeProps.openNewContactPage}
      />
    </>
  );
};

export const DesktopWalletPane = WalletPane;
