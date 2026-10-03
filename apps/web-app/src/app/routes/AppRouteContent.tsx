import {
  Card,
  Divider,
  LoadingState,
  Row,
  size,
  space,
  Stack,
} from "@linky-fit/ui";
import React from "react";
import { BottomTabBar, type BottomTabKey } from "../../components/BottomTabBar";
import { DesktopNavigation } from "../../components/DesktopNavigation";
import { PageBody } from "../../components/PageBody";
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
  EvoluServerNewPage,
  EvoluServerPage,
  EvoluServersPage,
  InspectorSettingsPage,
  LanguagePage,
  AppearancePage,
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
  RecurringPaymentFormPage,
  RecurringPaymentPage,
  TransactionsPage,
} from "../../pages";
import type { Route } from "../../types/route";
import {
  useAppShellCore,
  useMoneyRoutes,
  usePeopleRoutes,
} from "../context/AppShellContexts";
import {
  ContactsPane,
  DesktopContactsPane,
  WalletPane,
  type MainTabRouteProps,
} from "./MainTabPanes";
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

export interface MainTabRoutesProps {
  mainTabProps: MainTabRouteProps;
}

const assertNever = (route: never): never => {
  throw new Error(`Unhandled app route: ${JSON.stringify(route)}`);
};

const RoutePage = (): React.ReactElement => {
  const { route, t } = useAppShellCore();
  const peopleRoutes = usePeopleRoutes();
  const moneyRoutes = useMoneyRoutes();

  switch (route.kind) {
    case "contacts":
      return <ContactsPane />;
    case "wallet":
      return <WalletPane />;
    case "settings":
    case "advanced":
      return <AdvancedPage />;
    case "settingsUnits":
      return <SettingsPage />;
    case "settingsLanguage":
      return <LanguagePage />;
    case "settingsAppearance":
      return <AppearancePage />;
    case "settingsReceiveMethod":
      return <ReceiveMethodPage />;
    case "settingsMasterKeys":
      return <MasterKeysPage />;
    case "proxyPayments":
      return <ProxyPaymentsPage />;
    case "advancedAutoPayLimit":
      return <AdvancedAutoPayLimitPage />;
    case "advancedInspector":
      return <InspectorSettingsPage />;
    case "advancedInspectorTimeline":
      return (
        <React.Suspense fallback={<LoadingState label={t("loading")} />}>
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
    case "evoluServers":
      return <EvoluServersPage />;
    case "evoluCurrentData":
      return <EvoluCurrentDataPage />;
    case "evoluHistoryData":
      return <EvoluHistoryDataPage />;
    case "evoluServer":
      return <EvoluServerPage />;
    case "evoluServerNew":
      return <EvoluServerNewPage />;
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
    case "recurringPaymentNew":
      // The prefill lives in the hash query, which is not part of `route`;
      // keying on it gives each "Repeat regularly…" entry a fresh form.
      return <RecurringPaymentFormPage key={globalThis.location?.hash ?? ""} />;
    case "recurringPaymentEdit":
      return <RecurringPaymentFormPage editId={route.id} />;
    case "recurringPayment":
      return <RecurringPaymentPage id={route.id} />;
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
    case "profileEdit":
      return <ProfilePage {...peopleRoutes.profileProps} />;
    default:
      return assertNever(route satisfies never);
  }
};

interface PageFrameProps {
  children: React.ReactNode;
  /** The page lays out and scrolls its own content, like the chat. */
  fill: boolean;
}

/** Positioned so a floating action button stays in its corner while the page scrolls. */
const PageFrame = ({ children, fill }: PageFrameProps): React.ReactElement => (
  <Stack
    testID="page-frame"
    flex={1}
    minHeight={0}
    gap="$none"
    position="relative"
  >
    {fill ? (
      children
    ) : (
      <PageBody minHeight={0} overflowY="auto">
        {children}
      </PageBody>
    )}
  </Stack>
);

const getBottomTab = (route: Route): BottomTabKey | null => {
  switch (route.kind) {
    case "contacts":
    case "wallet":
    case "settings":
    case "profile":
      return route.kind;
    case "proxyPayments":
      return "proxy";
    default:
      return null;
  }
};

const PhoneRouteContent = (): React.ReactElement => {
  const { route, t } = useAppShellCore();
  const tab = getBottomTab(route);
  return (
    <>
      <PageFrame fill={route.kind === "chat"}>
        <RoutePage />
      </PageFrame>
      {tab ? <BottomTabBar activeTab={tab} t={t} /> : null}
    </>
  );
};

// The panes keep the phone-era app width minus the rail, which stays pinned to the window edge.
const desktopPanesWidth = size.appWidth - size.hero - space.lg;

export const AppRouteContent = (): React.ReactElement => {
  const { route, scanIsOpen, t } = useAppShellCore();
  const isDesktopSplitView = useDesktopSplitView();

  if (!isDesktopSplitView) return <PhoneRouteContent />;

  const section = getDesktopRouteSection(route);
  const secondaryIsOpen = !isDesktopSectionRoot(route) || scanIsOpen;

  return (
    <Row
      testID="desktop-layout"
      flex={1}
      minHeight={0}
      width="100%"
      alignItems="stretch"
      gap="$lg"
      padding="$lg"
    >
      <DesktopNavigation />
      <Row flex={1} minWidth={0} alignItems="stretch" justifyContent="center">
        <Row
          flex={1}
          maxWidth={desktopPanesWidth}
          alignItems="stretch"
          gap="$lg"
        >
          <Stack
            role="main"
            position="relative"
            flex={secondaryIsOpen ? 0.88 : 1}
            minHeight={0}
            paddingVertical="$lg"
            paddingHorizontal="$xl"
            overflowY={section === "contacts" ? "hidden" : "auto"}
          >
            {section === "contacts" ? (
              <DesktopContactsPane />
            ) : section === "wallet" ? (
              <WalletPane />
            ) : section === "proxy" ? (
              <ProxyPaymentsPage />
            ) : (
              <AdvancedPage />
            )}
          </Stack>

          {secondaryIsOpen ? (
            <Card
              outlined
              backgroundColor="$background"
              role="region"
              position="relative"
              aria-label={t("detail")}
              flex={1.12}
              minHeight={0}
              padding="$none"
              gap="$none"
              overflow="hidden"
            >
              {scanIsOpen ? (
                <ScanModal />
              ) : (
                <>
                  <Topbar desktopDetail />
                  <Divider />
                  {route.kind === "chat" ? (
                    <PageFrame fill>
                      <RoutePage />
                    </PageFrame>
                  ) : (
                    <PageBody gutter="detail" minHeight={0} overflowY="auto">
                      <RoutePage />
                    </PageBody>
                  )}
                </>
              )}
            </Card>
          ) : null}
        </Row>
      </Row>
    </Row>
  );
};
