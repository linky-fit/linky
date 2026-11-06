import {
  border,
  EmptyState,
  LoadingState,
  Row,
  Stack,
  Text,
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
  CashPage,
  CashuTokenEmitPage,
  CashuTokenNewPage,
  CashuTokenRoute,
  CashuTokensRoute,
  CashuProofsRoute,
  ChatRoute,
  CollaborationPage,
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
  LnInvoicePayRoute,
  ManualPayRoute,
  MasterKeysPage,
  NostrIdentityPage,
  MintDetailPage,
  MintNewPage,
  MintsPage,
  NostrRelayNewPage,
  NostrRelayPage,
  NostrRelaysPage,
  OnchainTransferNewPage,
  OnchainTransferPage,
  ProfileRoute,
  ListingDetailPage,
  ListingFormPage,
  ListingsPage,
  ProxyPaymentsPage,
  PushDebugPage,
  SettingsPage,
  SpdPaymentRoute,
  TopupInvoiceRoute,
  TopupNoAmountPage,
  TopupPage,
  SupportLinkyPage,
  TutorialPage,
  WhatsNewPage,
  BlockedPage,
  RecurringPaymentFormPage,
  RecurringPaymentPage,
  TransactionPage,
  WalletHistoryPage,
} from "../../pages";
import { useRouting } from "../../hooks/useRouting";
import type { Route } from "../../types/route";
import { useTranslation } from "../hooks/shell";
import { useScanIsOpen } from "../hooks/shell/scan";
import { ContactsPane, DesktopContactsPane, WalletPane } from "./MainTabPanes";
import {
  getDesktopRouteSection,
  isDesktopSectionRoot,
  type DesktopRouteSection,
} from "./desktopRouteSection";
import type { I18nKey } from "../../i18n";

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
    case "walletHistory":
      return <WalletHistoryPage />;
    case "settings":
    case "advanced":
      return <AdvancedPage />;
    case "settingsUnits":
      return <SettingsPage />;
    case "settingsTutorial":
      return <TutorialPage />;
    case "settingsSupport":
      return <SupportLinkyPage />;
    case "settingsWhatsNew":
      return <WhatsNewPage />;
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
    case "collaboration":
      return <CollaborationPage />;
    case "proxyPayments":
      return <ProxyPaymentsPage />;
    case "cash":
      return <CashPage />;
    case "listings":
      return <ListingsPage />;
    case "listingNew":
      return <ListingFormPage />;
    case "listingEdit":
      return <ListingFormPage id={route.id} />;
    case "listing":
      return (
        <ListingDetailPage
          author={route.author}
          listingId={route.listingId}
          messageId={route.messageId}
        />
      );
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
    case "onchainSend":
      return (
        <OnchainTransferNewPage
          key={`${route.payoutAddress}:${route.amount}`}
          direction="send"
          prefill={route}
        />
      );
    case "onchainReceive":
      return <OnchainTransferNewPage direction="receive" prefill={null} />;
    case "onchainTransfer":
      return <OnchainTransferPage id={route.id} />;
    case "transaction":
      return <TransactionPage id={route.id} />;
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
    case "lnInvoicePay":
      return <LnInvoicePayRoute invoice={route.invoice} />;
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
    case "collaboration":
      return "collaboration";
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

type DesktopListSection = Exclude<DesktopRouteSection, "wallet">;

const desktopSectionTitle = {
  contacts: "contactsTitle",
  wallet: "wallet",
  collaboration: "collaboration",
  settings: "settings",
} as const satisfies Record<DesktopRouteSection, I18nKey>;

/** What the detail pane shows while nothing in the section's list is open. */
const DesktopSectionDetail = ({
  section,
}: {
  section: DesktopListSection;
}): React.ReactElement => {
  const { t } = useTranslation();
  const empty = {
    contacts: { icon: "MessageCircle", title: t("contactsSelectHint") },
    collaboration: { icon: "Handshake", title: t("collaborationSelectHint") },
    settings: { icon: "Settings", title: t("settingsSelectHint") },
  } as const;
  return (
    <Stack flex={1} justifyContent="center" paddingHorizontal="$xl">
      <EmptyState icon={empty[section].icon} title={empty[section].title} />
    </Stack>
  );
};

/** A page centred at reading width below its own top bar, or the scanner while it is open. */
const DesktopRoutePane = (): React.ReactElement => {
  const route = useRouting();
  const scanIsOpen = useScanIsOpen();
  if (scanIsOpen) return <ScanModal />;
  const isChat = route.kind === "chat";
  return (
    <>
      <Stack
        width="100%"
        maxWidth={isChat ? "$contentWidth" : "$readable"}
        alignSelf="center"
      >
        <Topbar desktopDetail />
      </Stack>
      {isChat ? (
        <PageFrame fill>
          <RoutePage />
        </PageFrame>
      ) : (
        <PageBody gutter="detail">
          <Stack
            flexGrow={1}
            width="100%"
            maxWidth="$readable"
            alignSelf="center"
          >
            <RoutePage />
          </Stack>
        </PageBody>
      )}
    </>
  );
};

/** The wallet alone fills the space beside the navigation until one of its pages opens beside it. */
const DesktopWalletPane = (): React.ReactElement => {
  const { t } = useTranslation();
  return (
    <Stack
      role="main"
      position="relative"
      flex={1}
      minWidth={0}
      minHeight={0}
      gap="$none"
      overflow="hidden"
    >
      <Stack paddingHorizontal="$xxl" paddingTop="$xl">
        <Text
          variant="heading"
          color="$colorStrong"
          role="heading"
          width="100%"
          maxWidth="$readable"
          alignSelf="center"
        >
          {t("wallet")}
        </Text>
      </Stack>
      <PageBody gutter="detail" paddingTop="$none">
        <Stack
          flexGrow={1}
          width="100%"
          maxWidth="$readable"
          alignSelf="center"
        >
          <WalletPane />
        </Stack>
      </PageBody>
    </Stack>
  );
};

const DesktopSplitPanes = ({
  section,
}: {
  section: DesktopRouteSection;
}): React.ReactElement => {
  const route = useRouting();
  const { t } = useTranslation();
  const scanIsOpen = useScanIsOpen();
  const secondaryIsOpen = !isDesktopSectionRoot(route) || scanIsOpen;
  if (section === "wallet" && !secondaryIsOpen) return <DesktopWalletPane />;
  return (
    <>
      <Stack
        role="main"
        position="relative"
        width="$sidebar"
        flexShrink={0}
        minHeight={0}
        overflowY={section === "contacts" ? "hidden" : "auto"}
      >
        <Stack
          flex={1}
          minHeight={0}
          width="100%"
          position="relative"
          paddingTop="$xl"
          // The contacts list scrolls on its own, so it runs to the column's bottom edge.
          paddingBottom={section === "contacts" ? "$none" : "$lg"}
          paddingHorizontal="$xl"
        >
          <Text
            variant="heading"
            color="$colorStrong"
            role="heading"
            marginBottom="$lg"
          >
            {t(desktopSectionTitle[section])}
          </Text>
          {section === "contacts" ? (
            <DesktopContactsPane />
          ) : section === "wallet" ? (
            <WalletPane />
          ) : section === "collaboration" ? (
            <CollaborationPage />
          ) : (
            <AdvancedPage />
          )}
        </Stack>
      </Stack>

      <Stack
        role="region"
        position="relative"
        aria-label={t("detail")}
        flex={1}
        minWidth={0}
        minHeight={0}
        gap="$none"
        overflow="hidden"
        // Both panes share the page fill, so a hairline is what tells them apart.
        borderLeftWidth={border.hairline}
        borderColor="$borderColor"
      >
        {secondaryIsOpen || section === "wallet" ? (
          <DesktopRoutePane />
        ) : (
          <DesktopSectionDetail section={section} />
        )}
      </Stack>
    </>
  );
};

export const AppRouteContent = (): React.ReactElement => {
  const route = useRouting();
  const isDesktopSplitView = useDesktopSplitView();

  if (!isDesktopSplitView) return <PhoneRouteContent />;

  const section = getDesktopRouteSection(route);
  return (
    <Row
      testID="desktop-layout"
      flex={1}
      minHeight={0}
      width="100%"
      alignItems="stretch"
      gap="$none"
    >
      <DesktopNavigation />
      <DesktopSplitPanes section={section} />
    </Row>
  );
};
