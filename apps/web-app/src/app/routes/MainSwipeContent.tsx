import { UserPlus as ContactAddIcon } from "lucide-react";
import React from "react";
import { BottomTabBar } from "../../components/BottomTabBar";

import { ContactsChecklist } from "../../components/ContactsChecklist";
import { useDesktopSplitView } from "../../hooks/useDesktopSplitView";
import type { Translate } from "../../i18n";
import { ContactsPage } from "../../pages/ContactsPage";
import { WalletPage } from "../../pages/WalletPage";
import type { Route } from "../../types/route";
import { nowSeconds } from "../../utils/time";
import { useMainSwipeRoutes } from "../context/AppShellContexts";
import { useShowProfileQrOnTilt } from "../hooks/useShowProfileQrOnTilt";
import { getActiveBankPaymentOfferContacts } from "../lib/bankPaymentOffer";
import { useMainSwipeProgress } from "../lib/mainSwipeProgressStore";
import type {
  ContactRowLike,
  ContactsGuideKey,
  LocalNostrMessage,
} from "../types/appTypes";

export interface MainSwipeRouteProps {
  activeGroup: string | null;
  bottomTabActive: "contacts" | "wallet" | null;
  canAddContact: boolean;
  cashuTotalBalance: number;
  bankPaymentOfferMessages: readonly LocalNostrMessage[];
  contactsOnboardingCelebrating: boolean;
  contactsOnboardingTasks: {
    done: number;
    percent: number;
    tasks: ReadonlyArray<{ done: boolean; key: string; label: string }>;
    total: number;
  };
  contactsSearch: string;
  contactsSearchInputRef: React.RefObject<HTMLInputElement | null>;
  contactFilterOptions: Array<{ count: number; label: string; value: string }>;
  conversationsLabel: string;
  dismissContactsOnboarding: () => void;
  handleMainSwipeTabChange: (target: "contacts" | "wallet") => void;
  mainSwipeRef: React.RefObject<HTMLDivElement | null>;
  openNewContactPage: () => void;
  openProfileQr: () => void;
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
  showProfileQrOnTiltEnabled: boolean;
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
  bankPaymentOfferMessages: readonly LocalNostrMessage[],
  visibleContacts: MainSwipeRouteProps["visibleContacts"],
): VisibleContactSections => {
  const [nowSec, setNowSec] = React.useState(() => nowSeconds());
  const activeOffers = React.useMemo(
    () => getActiveBankPaymentOfferContacts(bankPaymentOfferMessages, nowSec),
    [bankPaymentOfferMessages, nowSec],
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

// Per-frame swipe progress subscribers are isolated in these two small
// components so drag updates re-render only the tab bar and the FAB, not the
// whole swipe content with both pages.
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
  canAddContact: boolean;
  label: string;
  onClick: () => void;
}

const MainSwipeFab = ({
  canAddContact,
  label,
  onClick,
}: MainSwipeFabProps): React.ReactElement => {
  const { progress } = useMainSwipeProgress();
  return (
    <button
      type="button"
      className={`contacts-fab main-swipe-fab${canAddContact ? "" : " is-disabled"}`}
      onClick={onClick}
      aria-disabled={!canAddContact}
      aria-label={label}
      title={label}
      data-guide="contact-add-button"
      style={{
        transform: `translateX(${-progress * 100}%)`,
        opacity: Math.max(0, 1 - progress * 1.1),
        pointerEvents: progress < 0.5 ? "auto" : "none",
      }}
    >
      <ContactAddIcon className="contacts-fab-svgIcon" />
    </button>
  );
};

export const MainSwipeContent = (): React.ReactElement => {
  const { mainSwipeProps } = useMainSwipeRoutes();
  const {
    activeGroup,
    bottomTabActive,
    canAddContact,
    cashuTotalBalance,
    bankPaymentOfferMessages,
    contactsOnboardingCelebrating,
    contactsOnboardingTasks,
    contactsSearch,
    contactsSearchInputRef,
    contactFilterOptions,
    conversationsLabel,
    dismissContactsOnboarding,
    dismissWalletWarning,
    handleMainSwipeTabChange,
    mainSwipeRef,
    openNewContactPage,
    openProfileQr,
    openWalletScan,
    otherContactsLabel,
    renderContactCard,
    route,
    scanIsOpen,
    setActiveGroup,
    setContactsSearch,
    showContactsOnboarding,
    showWalletWarning,
    showGroupFilter,
    showProfileQrOnTiltEnabled,
    startContactsGuide,
    t,
    visibleContacts,
  } = mainSwipeProps;
  const isDesktopSplitView = useDesktopSplitView();
  const visibleContactSections = useVisibleContactSections(
    bankPaymentOfferMessages,
    visibleContacts,
  );

  useShowProfileQrOnTilt({
    enabled:
      showProfileQrOnTiltEnabled &&
      (route.kind === "contacts" || route.kind === "wallet") &&
      !scanIsOpen,
    onShowProfileQr: openProfileQr,
  });

  return (
    <>
      <div className="main-swipe" ref={mainSwipeRef}>
        <div
          className="main-swipe-page main-swipe-contacts-page"
          aria-hidden={!isDesktopSplitView && route.kind !== "contacts"}
        >
          <h2 className="desktop-main-pane-title">{t("contactsTitle")}</h2>
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
            setContactsSearch={setContactsSearch}
            showGroupFilter={
              showGroupFilter ||
              (isDesktopSplitView && contactFilterOptions.length > 0)
            }
            activeGroup={activeGroup}
            setActiveGroup={setActiveGroup}
            filterOptions={contactFilterOptions}
            visibleContacts={visibleContactSections}
            conversationsLabel={conversationsLabel}
            otherContactsLabel={otherContactsLabel}
            renderContactCard={renderContactCard}
            bottomTabActive={bottomTabActive}
            canAddContact={canAddContact}
            openNewContactPage={openNewContactPage}
            showBottomTabBar={false}
            showFab={false}
            t={t}
          />
        </div>
        <div
          className="main-swipe-page main-swipe-wallet-page"
          aria-hidden={!isDesktopSplitView && route.kind !== "wallet"}
        >
          <h2 className="desktop-main-pane-title">{t("wallet")}</h2>
          <WalletPage
            cashuTotalBalance={cashuTotalBalance}
            openScan={openWalletScan}
            scanIsOpen={scanIsOpen}
            bottomTabActive={bottomTabActive}
            dismissWalletWarning={dismissWalletWarning}
            showWalletWarning={showWalletWarning}
            showBottomTabBar={false}
            t={t}
          />
        </div>
      </div>
      <MainSwipeBottomTabBar
        activeTab={bottomTabActive}
        contactsLabel={t("contactsTitle")}
        onTabChange={handleMainSwipeTabChange}
        t={t}
        walletLabel={t("wallet")}
      />
      <MainSwipeFab
        canAddContact={canAddContact}
        label={t("addContact")}
        onClick={openNewContactPage}
      />
    </>
  );
};

export const DesktopContactsPane = (): React.ReactElement => {
  const { mainSwipeProps } = useMainSwipeRoutes();
  const {
    activeGroup,
    bankPaymentOfferMessages,
    canAddContact,
    contactsOnboardingCelebrating,
    contactsOnboardingTasks,
    contactsSearch,
    contactsSearchInputRef,
    contactFilterOptions,
    conversationsLabel,
    dismissContactsOnboarding,
    openNewContactPage,
    otherContactsLabel,
    renderContactCard,
    setActiveGroup,
    setContactsSearch,
    showContactsOnboarding,
    startContactsGuide,
    t,
    visibleContacts,
  } = mainSwipeProps;
  const visibleContactSections = useVisibleContactSections(
    bankPaymentOfferMessages,
    visibleContacts,
  );

  return (
    <div className="desktop-primary-content desktop-contacts-pane">
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
        setContactsSearch={setContactsSearch}
        showGroupFilter={contactFilterOptions.length > 0}
        activeGroup={activeGroup}
        setActiveGroup={setActiveGroup}
        filterOptions={contactFilterOptions}
        visibleContacts={visibleContactSections}
        conversationsLabel={conversationsLabel}
        otherContactsLabel={otherContactsLabel}
        renderContactCard={renderContactCard}
        bottomTabActive="contacts"
        canAddContact={canAddContact}
        openNewContactPage={openNewContactPage}
        showBottomTabBar={false}
        showFab={false}
        t={t}
      />
      <button
        type="button"
        className={`contacts-fab desktop-contacts-fab${canAddContact ? "" : " is-disabled"}`}
        onClick={openNewContactPage}
        aria-disabled={!canAddContact}
        aria-label={t("addContact")}
        title={t("addContact")}
      >
        <ContactAddIcon className="contacts-fab-svgIcon" />
      </button>
    </div>
  );
};

export const DesktopWalletPane = (): React.ReactElement => {
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
    <div className="desktop-primary-content desktop-wallet-pane">
      <WalletPage
        cashuTotalBalance={cashuTotalBalance}
        openScan={openWalletScan}
        scanIsOpen={scanIsOpen}
        bottomTabActive="wallet"
        dismissWalletWarning={dismissWalletWarning}
        showWalletWarning={showWalletWarning}
        showBottomTabBar={false}
        t={t}
      />
    </div>
  );
};
