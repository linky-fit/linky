/* eslint-disable react-refresh/only-export-components */
import React from "react";
import type { ContactId } from "../../evolu";
import type { ScanDiagnostics } from "../hooks/useGuideScannerDomain";
import type { Lang } from "../../i18n";
import type { LnurlAuthPreview } from "../../lnurlAuth";
import type { LnurlWithdrawPreview } from "../../lnurlPay";
import type { PendingSiteLogin } from "../../siteLogin";
import type { Route } from "../../types/route";
import type {
  DisplayAmountParts,
  DisplayCurrency,
  FiatRates,
} from "../../utils/displayAmounts";
import type { LightningInvoicePreview } from "@linky-fit/linkshu";
import type { CashuPaymentRequestMessageInfo } from "../lib/paymentRequestMessage";
import type {
  MainTabRoutesProps,
  MoneyRoutesProps,
  PeopleRoutesProps,
} from "../routes/AppRouteContent";
import type { ContactsGuideStep, TopbarButton } from "../types/appTypes";
import type { PaidOverlayDetails, PaidOverlayPhase } from "../lib/paidOverlay";
import {
  SystemSettingsContextsProvider,
  type AdvancedSettingsContextValue,
  type EvoluSettingsContextValue,
  type MintSettingsContextValue,
  type RelaySettingsContextValue,
} from "./SystemSettingsContexts";
import type { Translate } from "../../i18n";

interface ChatContact {
  contactId: ContactId | null;
  isUnknownContact?: boolean;
  name: string | null;
  npub: string | null;
}

export interface AppShellCoreContextValue {
  allowedDisplayCurrencies: readonly DisplayCurrency[];
  cashuBalance: number;
  cashuBalanceAfterMelt: number;
  cashuIsBusy: boolean;
  chatTopbarContact: ChatContact | null;
  contactsGuide: { step: number; task: string } | null;
  contactsGuideActiveStep: {
    idx: number;
    step: ContactsGuideStep;
    total: number;
  } | null;
  contactsGuideHighlightRect: {
    height: number;
    left: number;
    top: number;
    width: number;
  } | null;
  currentNpub: string | null;
  currentNsec: string | null;
  decimalAmountInputEnabled: boolean;
  sendReadReceiptsEnabled: boolean;
  displayCurrency: DisplayCurrency;
  effectiveProfileName: string | null;
  effectiveProfilePicture: string | null;
  evoluAppOwnerId: string | null;
  fiatRates: FiatRates | null;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  lang: Lang;
  nfcWritePromptKind: "profile" | "token" | null;
  nostrPictureByNpub: Record<string, string | null>;
  paidOverlayIsOpen: boolean;
  paidOverlayPhase: PaidOverlayPhase;
  paidOverlayTitle: string | null;
  paidOverlayDetails: PaidOverlayDetails | null;
  pendingPaymentMintMeltConfirmation: {
    fromMint: string;
    toMint: string;
  } | null;
  pendingLnurlAuthConfirmation: LnurlAuthPreview | null;
  pendingLnurlWithdrawConfirmation: LnurlWithdrawPreview | null;
  pendingSiteLoginConfirmation: PendingSiteLogin | null;
  pendingLightningInvoiceConfirmation: LightningInvoicePreview | null;
  pendingCashuPaymentRequestConfirmation: CashuPaymentRequestMessageInfo | null;
  postPaySaveContact: {
    amountSat: number;
    lnAddress: string;
  } | null;
  profileShareOverlayIsOpen: boolean;
  route: Route;
  scanAllowsManualContact: boolean;
  scanDiagnostics: ScanDiagnostics;
  scanCanSwitchCamera: boolean;
  scanEntryPoint: "contacts" | "receive" | "send" | null;
  scanIsOpen: boolean;
  scanVideoRef: React.RefObject<HTMLVideoElement | null>;
  shareOptionsText: string | null;
  showProfileQrOnTiltEnabled: boolean;
  t: Translate;
  topbar: TopbarButton | null;
  topbarRight: TopbarButton | null;
  topbarTitle: string | null;
  lnurlAuthIsBusy: boolean;
  lnurlAuthIsDone: boolean;
  lnurlWithdrawIsBusy: boolean;
  siteLoginIsBusy: boolean;
  siteLoginIsDone: boolean;
}

export interface AppShellActionsContextValue {
  cancelPendingNfcWrite: () => void;
  closePaymentMintMeltConfirmation: () => void;
  closeProfileShareOverlay: () => void;
  closeShareOptions: () => void;
  closeLnurlAuthConfirmation: () => void;
  closeLnurlWithdrawConfirmation: () => void;
  closeSiteLoginConfirmation: () => void;
  closeLightningInvoiceConfirmation: () => void;
  closeScan: () => void;
  confirmPaymentMintMelt: () => Promise<void>;
  confirmLnurlAuth: () => Promise<void>;
  confirmLnurlWithdraw: () => Promise<void>;
  confirmSiteLogin: () => Promise<void>;
  confirmLightningInvoicePayment: () => Promise<void>;
  closeCashuPaymentRequestConfirmation: () => void;
  confirmCashuPaymentRequest: () => Promise<void>;
  contactsGuideNav: {
    back: () => void;
    next: () => void;
  };
  copyText: (text: string) => Promise<void>;
  cycleScanCamera: () => void;
  onPickScanImage: () => void;
  openFeedbackContact: () => void;
  openIssueTokenFromScan: () => void;
  openManualContactFromScan: () => void;
  openManualPayFromScan: () => void;
  openProfileQr: () => void;
  openReceiveScan: () => void;
  pasteScanValue: () => Promise<void>;
  copyShareOptionsText: () => Promise<void>;
  setDisplayCurrency: (currency: DisplayCurrency) => void;
  setContactNewPrefill: (prefill: {
    lnAddress: string;
    npub: string | null;
    suggestedName: string | null;
  }) => void;
  setLang: (lang: Lang) => void;
  setPostPaySaveContact: (
    value: {
      amountSat: number;
      lnAddress: string;
    } | null,
  ) => void;
  stopContactsGuide: () => void;
  shareOptionsViaEmail: () => void;
  shareOptionsViaSms: () => void;
  shareOptionsViaWhatsApp: () => void;
  toggleAllowedDisplayCurrency: (currency: DisplayCurrency) => void;
  toggleDecimalAmountInput: () => void;
  toggleSendReadReceipts: () => void;
  toggleShowProfileQrOnTilt: () => void;
}

export interface AppShellRouteContextValue {
  mainTabRoutes: MainTabRoutesProps;
  moneyRoutes: MoneyRoutesProps;
  peopleRoutes: PeopleRoutesProps;
}

interface AppShellContextsProviderProps {
  actions: AppShellActionsContextValue;
  advancedSettings: AdvancedSettingsContextValue;
  children: React.ReactNode;
  core: AppShellCoreContextValue;
  evoluSettings: EvoluSettingsContextValue;
  mintSettings: MintSettingsContextValue;
  relaySettings: RelaySettingsContextValue;
  routes: AppShellRouteContextValue;
}

const AppShellCoreContext =
  React.createContext<AppShellCoreContextValue | null>(null);
const AppShellActionsContext =
  React.createContext<AppShellActionsContextValue | null>(null);
const AppShellRouteContext =
  React.createContext<AppShellRouteContextValue | null>(null);

const useContextValue = <T,>(contextValue: T | null, hookName: string): T => {
  if (contextValue === null) {
    throw new Error(`${hookName} must be used within AppShellContextsProvider`);
  }

  return contextValue;
};

export const AppShellContextsProvider = ({
  actions,
  advancedSettings,
  children,
  core,
  evoluSettings,
  mintSettings,
  relaySettings,
  routes,
}: AppShellContextsProviderProps): React.ReactElement => {
  return (
    <AppShellCoreContext.Provider value={core}>
      <AppShellActionsContext.Provider value={actions}>
        <AppShellRouteContext.Provider value={routes}>
          <SystemSettingsContextsProvider
            advancedSettings={advancedSettings}
            evoluSettings={evoluSettings}
            mintSettings={mintSettings}
            relaySettings={relaySettings}
          >
            {children}
          </SystemSettingsContextsProvider>
        </AppShellRouteContext.Provider>
      </AppShellActionsContext.Provider>
    </AppShellCoreContext.Provider>
  );
};

export const useAppShellCore = (): AppShellCoreContextValue =>
  useContextValue(React.useContext(AppShellCoreContext), "useAppShellCore");

export const useAppShellActions = (): AppShellActionsContextValue =>
  useContextValue(
    React.useContext(AppShellActionsContext),
    "useAppShellActions",
  );

const useAppShellRouteContext = (): AppShellRouteContextValue =>
  useContextValue(
    React.useContext(AppShellRouteContext),
    "useAppShellRouteContext",
  );

export const usePeopleRoutes = (): PeopleRoutesProps =>
  useAppShellRouteContext().peopleRoutes;

export const useMoneyRoutes = (): MoneyRoutesProps =>
  useAppShellRouteContext().moneyRoutes;

export const useMainTabRoutes = (): MainTabRoutesProps =>
  useAppShellRouteContext().mainTabRoutes;
