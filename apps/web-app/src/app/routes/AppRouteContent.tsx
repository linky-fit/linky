import React from "react";
import { DesktopNavigation } from "../../components/DesktopNavigation";
import { MobileBottomNav } from "../../components/MobileBottomNav";
import { ScanModal } from "../../components/ScanModal";
import { Topbar } from "../../components/Topbar";
import { useDesktopSplitView } from "../../hooks/useDesktopSplitView";
import {
  AdvancedAutoPayLimitPage,
  AdvancedPage,
  BankPaymentOfferDetailPage,
  CashuTokenEmitPage,
  CashuTokenNewPage,
  CashuTokenPage,
  CashuTokensPage,
  CashuProofsPage,
  ChatPage,
  ContactEditPage,
  ContactNewPage,
  ContactPage,
  ContactPayPage,
  ChatStoragePage,
  EvoluCurrentDataPage,
  EvoluDataDetailPage,
  EvoluHistoryDataPage,
  EvoluRelayNewPage,
  EvoluRelayPage,
  EvoluRelaysPage,
  InspectorSettingsPage,
  LanguagePage,
  ReceiveMethodPage,
  LnAddressPayPage,
  ManualPayPage,
  MasterKeysPage,
  MintDetailPage,
  MintNewPage,
  MintsPage,
  NostrRelayNewPage,
  NostrRelayPage,
  NostrRelaysPage,
  ProfilePage,
  ProxyPaymentsPage,
  PushDebugPage,
  SettingsPage,
  SpdPaymentPage,
  TopupInvoicePage,
  TopupNoAmountPage,
  TopupPage,
  TransactionsPage,
} from "../../pages";
import {
  useAppShellCore,
  useMoneyRoutes,
  usePeopleRoutes,
} from "../context/AppShellContexts";
import {
  DesktopContactsPane,
  DesktopWalletPane,
  MainSwipeContent,
  type MainSwipeRouteProps,
} from "./MainSwipeContent";
import {
  getDesktopRouteSection,
  isDesktopSectionRoot,
} from "./desktopRouteSection";

const InspectorPage = React.lazy(() => import("../../pages/InspectorPage"));

export interface PeopleRoutesProps {
  bankPaymentOfferDetailProps: () => React.ComponentProps<
    typeof BankPaymentOfferDetailPage
  >;
  chatProps: React.ComponentProps<typeof ChatPage>;
  contactEditProps: React.ComponentProps<typeof ContactEditPage>;
  contactNewProps: React.ComponentProps<typeof ContactNewPage>;
  contactPayProps: React.ComponentProps<typeof ContactPayPage>;
  contactProps: React.ComponentProps<typeof ContactPage>;
  profileProps: React.ComponentProps<typeof ProfilePage>;
}

export interface MoneyRoutesProps {
  cashuTokenEmitProps: React.ComponentProps<typeof CashuTokenEmitPage>;
  cashuTokenNewProps: React.ComponentProps<typeof CashuTokenNewPage>;
  cashuTokenProps: () => React.ComponentProps<typeof CashuTokenPage>;
  cashuProofsProps: React.ComponentProps<typeof CashuProofsPage>;
  cashuTokensProps: React.ComponentProps<typeof CashuTokensPage>;
  lnAddressPayProps: React.ComponentProps<typeof LnAddressPayPage>;
  manualPayProps: React.ComponentProps<typeof ManualPayPage>;
  spdPaymentProps: React.ComponentProps<typeof SpdPaymentPage>;
  topupInvoiceProps: React.ComponentProps<typeof TopupInvoicePage>;
  topupProps: React.ComponentProps<typeof TopupPage>;
}

export interface MainSwipeRoutesProps {
  mainSwipeProps: MainSwipeRouteProps;
}

const assertNever = (route: never): never => {
  throw new Error(`Unhandled app route: ${JSON.stringify(route)}`);
};

const RoutePage = (): React.ReactElement => {
  const { route } = useAppShellCore();
  const peopleRoutes = usePeopleRoutes();
  const moneyRoutes = useMoneyRoutes();

  switch (route.kind) {
    case "contacts":
    case "wallet":
      return <MainSwipeContent />;
    case "settings":
      return (
        <>
          <AdvancedPage />
          <MobileBottomNav activeTab="settings" />
        </>
      );
    case "advanced":
      return <AdvancedPage />;
    case "settingsUnits":
      return <SettingsPage />;
    case "settingsLanguage":
      return <LanguagePage />;
    case "settingsReceiveMethod":
      return <ReceiveMethodPage />;
    case "settingsMasterKeys":
      return <MasterKeysPage />;
    case "settingsProxyPayments":
      return <ProxyPaymentsPage />;
    case "advancedAutoPayLimit":
      return <AdvancedAutoPayLimitPage />;
    case "advancedInspector":
      return <InspectorSettingsPage />;
    case "advancedInspectorTimeline":
      return (
        <React.Suspense fallback={<div className="muted">Loading…</div>}>
          <InspectorPage />
        </React.Suspense>
      );
    case "advancedPushDebug":
      return <PushDebugPage />;
    case "mints":
      return <MintsPage />;
    case "mintNew":
      return <MintNewPage />;
    case "mint":
      return <MintDetailPage />;
    case "chatStorage":
      return <ChatStoragePage />;
    case "evoluRelays":
      return <EvoluRelaysPage />;
    case "evoluCurrentData":
      return <EvoluCurrentDataPage />;
    case "evoluHistoryData":
      return <EvoluHistoryDataPage />;
    case "evoluRelay":
      return <EvoluRelayPage />;
    case "evoluRelayNew":
      return <EvoluRelayNewPage />;
    case "evoluData":
      return <EvoluDataDetailPage />;
    case "nostrRelays":
      return <NostrRelaysPage />;
    case "nostrRelayNew":
      return <NostrRelayNewPage />;
    case "nostrRelay":
      return <NostrRelayPage />;
    case "topup":
      return <TopupPage {...moneyRoutes.topupProps} />;
    case "transactions":
      return <TransactionsPage />;
    case "topupNoAmount":
      return <TopupNoAmountPage />;
    case "topupInvoice":
      return <TopupInvoicePage {...moneyRoutes.topupInvoiceProps} />;
    case "cashuProofs":
      return <CashuProofsPage {...moneyRoutes.cashuProofsProps} />;
    case "cashuTokens":
      return <CashuTokensPage {...moneyRoutes.cashuTokensProps} />;
    case "cashuTokenNew":
      return <CashuTokenNewPage {...moneyRoutes.cashuTokenNewProps} />;
    case "cashuTokenEmit":
      return <CashuTokenEmitPage {...moneyRoutes.cashuTokenEmitProps} />;
    case "cashuToken":
      return <CashuTokenPage {...moneyRoutes.cashuTokenProps()} />;
    case "contact":
      return <ContactPage {...peopleRoutes.contactProps} />;
    case "contactPay":
      return <ContactPayPage {...peopleRoutes.contactPayProps} />;
    case "lnAddressPay":
      return <LnAddressPayPage {...moneyRoutes.lnAddressPayProps} />;
    case "manualPay":
      return <ManualPayPage {...moneyRoutes.manualPayProps} />;
    case "bankPayment":
    case "bankPaymentNew":
      return <SpdPaymentPage {...moneyRoutes.spdPaymentProps} />;
    case "bankPaymentOffer":
      return (
        <BankPaymentOfferDetailPage
          {...peopleRoutes.bankPaymentOfferDetailProps()}
        />
      );
    case "chat":
      return <ChatPage {...peopleRoutes.chatProps} />;
    case "contactEdit":
      return <ContactEditPage {...peopleRoutes.contactEditProps} />;
    case "contactNew":
      return <ContactNewPage {...peopleRoutes.contactNewProps} />;
    case "profile":
      return (
        <>
          <ProfilePage {...peopleRoutes.profileProps} />
          <MobileBottomNav activeTab="profile" />
        </>
      );
    case "profileEdit":
      return <ProfilePage {...peopleRoutes.profileProps} />;
    default:
      return assertNever(route satisfies never);
  }
};

export const AppRouteContent = (): React.ReactElement => {
  const { route, scanIsOpen, t } = useAppShellCore();
  const isDesktopSplitView = useDesktopSplitView();

  if (!isDesktopSplitView) return <RoutePage />;

  const section = getDesktopRouteSection(route);
  const detailIsEmpty = isDesktopSectionRoot(route);
  const secondaryIsOpen = !detailIsEmpty || scanIsOpen;

  return (
    <div
      className={`desktop-app-layout${secondaryIsOpen ? "" : " is-primary-only"}`}
    >
      <DesktopNavigation />

      <main className="desktop-primary-pane">
        {section === "contacts" ? (
          <DesktopContactsPane />
        ) : section === "wallet" ? (
          <DesktopWalletPane />
        ) : (
          <div className="desktop-primary-content desktop-settings-pane">
            <AdvancedPage />
          </div>
        )}
      </main>

      {secondaryIsOpen ? (
        <section className="desktop-secondary-pane" aria-label={t("detail")}>
          {scanIsOpen ? (
            <ScanModal />
          ) : (
            <>
              <Topbar className="desktop-app-topbar" desktopDetail={true} />
              <div className="desktop-secondary-content">
                <RoutePage />
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
};
