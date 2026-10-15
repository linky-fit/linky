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
  BankPaymentOfferDetailRoute,
  CashuTokenEmitPage,
  CashuTokenNewPage,
  CashuTokenRoute,
  CashuTokensRoute,
  CashuProofsRoute,
  ChatRoute,
  ContactEditRoute,
  ContactNewRoute,
  ContactRoute,
  ContactPayRoute,
  ChatStoragePage,
  EvoluCurrentDataPage,
  EvoluDataDetailPage,
  EvoluHistoryDataPage,
  EvoluServerNewPage,
  EvoluServerPage,
  EvoluServersPage,
  InspectorSettingsPage,
  KeryxAnnouncementPage,
  KeryxCompaniesPage,
  KeryxCompanyNewPage,
  KeryxCompanyPage,
  LanguagePage,
  AppearancePage,
  ReceiveMethodPage,
  LnAddressPayRoute,
  ManualPayRoute,
  MasterKeysPage,
  NostrIdentityPage,
  MintDetailPage,
  MintNewPage,
  MintsPage,
  NostrRelayNewPage,
  NostrRelayPage,
  NostrRelaysPage,
  ProfileRoute,
  ProxyPaymentsPage,
  PushDebugPage,
  SettingsPage,
  SpdPaymentRoute,
  TopupInvoiceRoute,
  TopupNoAmountPage,
  TopupPage,
  TutorialPage,
  BlockedPage,
  RecurringPaymentFormPage,
  RecurringPaymentPage,
  TransactionsPage,
} from "../../pages";
import { useRouting } from "../../hooks/useRouting";
import type { Route } from "../../types/route";
import { useTranslation } from "../hooks/shell";
import { useScanIsOpen } from "../hooks/shell/scan";
import { ContactsPane, DesktopContactsPane, WalletPane } from "./MainTabPanes";
import {
  getDesktopRouteSection,
  isDesktopSectionRoot,
} from "./desktopRouteSection";

const InspectorPage = React.lazy(() => import("../../pages/InspectorPage"));

const assertNever = (route: never): never => {
  throw new Error(`Unhandled app route: ${JSON.stringify(route)}`);
};

const RoutePage = (): React.ReactElement => {
  const route = useRouting();
  const { t } = useTranslation();

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
    case "settingsTutorial":
      return <TutorialPage />;
    case "settingsBlocked":
      return <BlockedPage />;
    case "settingsLanguage":
      return <LanguagePage />;
    case "settingsAppearance":
      return <AppearancePage />;
    case "settingsReceiveMethod":
      return <ReceiveMethodPage />;
    case "settingsMasterKeys":
      return <MasterKeysPage />;
    case "settingsNostrIdentity":
      return <NostrIdentityPage />;
    case "keryxCompanies":
      return <KeryxCompaniesPage />;
    case "keryxCompanyNew":
      return <KeryxCompanyNewPage />;
    case "keryxCompany":
      return <KeryxCompanyPage id={route.id} />;
    case "keryxAnnouncement":
      return (
        <KeryxAnnouncementPage id={route.id} announcementKey={route.key} />
      );
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
      return <MintDetailPage mintUrl={route.mintUrl} />;
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
      return <TopupPage />;
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
      return <TopupInvoiceRoute />;
    case "cashuProofs":
      return <CashuProofsRoute />;
    case "cashuTokens":
      return <CashuTokensRoute />;
    case "cashuTokenNew":
      return <CashuTokenNewPage />;
    case "cashuTokenEmit":
      return <CashuTokenEmitPage />;
    case "cashuToken":
      return <CashuTokenRoute routeId={route.id} />;
    case "contact":
      return <ContactRoute route={route} />;
    case "contactPay":
      return <ContactPayRoute route={route} />;
    case "lnAddressPay":
      return <LnAddressPayRoute lnAddress={route.lnAddress} />;
    case "manualPay":
      return <ManualPayRoute />;
    case "bankPayment":
      return (
        <SpdPaymentRoute
          isEditing={route.editing === true}
          isManualEntry={false}
          spdPayload={route.spdPayload}
        />
      );
    case "bankPaymentNew":
      return <SpdPaymentRoute isEditing isManualEntry spdPayload="" />;
    case "bankPaymentOffer":
      return <BankPaymentOfferDetailRoute route={route} />;
    case "chat":
      return <ChatRoute route={route} />;
    case "contactEdit":
      return <ContactEditRoute route={route} />;
    case "contactNew":
      return <ContactNewRoute route={route} />;
    case "profile":
    case "profileEdit":
      return <ProfileRoute />;
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
    {fill ? children : <PageBody>{children}</PageBody>}
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
  const route = useRouting();
  const { t } = useTranslation();
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
  const route = useRouting();
  const { t } = useTranslation();
  const scanIsOpen = useScanIsOpen();
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
                    <PageBody gutter="detail">
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
