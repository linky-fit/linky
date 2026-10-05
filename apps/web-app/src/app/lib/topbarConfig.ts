import type { ContactId } from "../../evolu";
import { navigateTo, returnFromBankPaymentOffer } from "../../hooks/useRouting";
import type { Route } from "../../types/route";
import { setBankPaymentOfferMinimized } from "./bankPaymentOfferStorage";
import type { TopbarButton } from "../types/appTypes";
import type { I18nKey, Translate } from "../../i18n";

export interface BackActionContext {
  closeContactDetail: () => void;
  contactPayBackToChatId: ContactId | null;
  navigateToMainReturn: () => void;
}

interface BuildTopbarArgs extends BackActionContext {
  route: Route;
  t: Translate;
}

interface BuildTopbarRightArgs {
  chatEditContactId: ContactId | null;
  contactsFilterIsActive: boolean;
  hiddenTransactionsShown: boolean;
  isProfileEditing: boolean;
  openReceiveScan: () => void;
  openScan: () => void;
  route: Route;
  t: Translate;
  toggleContactsFilter: () => void;
  toggleHiddenTransactions: () => void;
  openMenu: () => void;
}

/**
 * Single source of truth for "go one level up" navigation.
 *
 * Both the top-left topbar button and the Android hardware/gesture back button
 * resolve through this, so the two can never drift apart as routes are added.
 * Returning `null` means the route is a root screen with nowhere to go back to
 * (the hardware back press then falls through and closes the app).
 */
export const resolveBackAction = (
  route: Route,
  {
    closeContactDetail,
    contactPayBackToChatId,
    navigateToMainReturn,
  }: BackActionContext,
): (() => void) | null => {
  switch (route.kind) {
    case "settings":
    case "advanced":
    case "profile":
      return navigateToMainReturn;

    case "settingsLanguage":
    case "settingsAppearance":
    case "settingsUnits":
    case "settingsReceiveMethod":
    case "settingsMasterKeys":
    case "keryxCompanies":
    case "advancedAutoPayLimit":
    case "advancedInspector":
    case "mints":
    case "relays":
      return () => navigateTo({ route: "settings" });

    case "bankPaymentNew":
      return () => navigateTo({ route: "proxyPayments" });

    case "advancedInspectorTimeline":
    case "advancedPushDebug":
      return () => navigateTo({ route: "advancedInspector" });

    case "mint":
    case "mintNew":
      return () => navigateTo({ route: "mints" });

    case "profileEdit":
      return () => navigateTo({ route: "profile" });

    case "keryxCompanyNew":
    case "keryxCompany":
      return () => navigateTo({ route: "keryxCompanies" });

    case "keryxAnnouncement": {
      const companyId = route.id;
      return () => navigateTo({ route: "keryxCompany", id: companyId });
    }

    case "bankPayment":
      // Leaving the edit form discards the draft; the page itself has no
      // cancel button.
      return route.editing
        ? () =>
            navigateTo({ route: "bankPayment", spdPayload: route.spdPayload })
        : () => navigateTo({ route: "wallet" });

    case "transactions":
    case "manualPay":
    case "cashuTokens":
    case "cashuTokenEmit":
    case "topup":
      return () => navigateTo({ route: "wallet" });

    case "recurringPaymentNew":
    case "recurringPayment":
      return () => navigateTo({ route: "transactions" });
    case "recurringPaymentEdit":
      return () => navigateTo({ route: "recurringPayment", id: route.id });

    case "topupNoAmount":
    case "topupInvoice":
      return () => navigateTo({ route: "topup" });

    case "bankPaymentOffer": {
      const { chatId, offerId } = route;
      return () => {
        setBankPaymentOfferMinimized(chatId, offerId, true);
        returnFromBankPaymentOffer(chatId);
      };
    }

    case "cashuProofs":
    case "cashuTokenNew":
    case "cashuToken":
      return () => navigateTo({ route: "cashuTokens" });

    case "evoluData":
      return () => navigateTo({ route: "advanced" });

    case "lnAddressPay":
    case "chat":
      return () => navigateTo({ route: "contacts" });

    case "nostrRelay":
    case "nostrRelayNew":
    case "evoluServer":
    case "evoluServerNew":
    case "chatStorage":
    case "evoluCurrentData":
    case "evoluHistoryData":
      return () => navigateTo({ route: "relays" });

    case "contactNew":
    case "contact":
      return closeContactDetail;

    case "contactEdit": {
      const contactId = route.id;
      return () => navigateTo({ route: "contact", id: contactId });
    }

    case "contactPay": {
      const contactId = route.id;
      const backToChat = (contactPayBackToChatId ?? "") === contactId;

      return () => {
        if (backToChat && contactId) {
          navigateTo({ route: "chat", id: contactId });
          return;
        }
        if (contactId) {
          navigateTo({ route: "contact", id: contactId });
          return;
        }
        navigateTo({ route: "contacts" });
      };
    }

    // Root screens: nothing above them.
    case "contacts":
    case "wallet":
    case "proxyPayments":
      return null;
  }
};

export const buildTopbar = ({
  closeContactDetail,
  contactPayBackToChatId,
  navigateToMainReturn,
  route,
  t,
}: BuildTopbarArgs): TopbarButton | null => {
  // Profile and settings are bottom-nav roots: no back chevron, although the
  // hardware back button still returns to the main screen.
  if (route.kind === "profile" || route.kind === "settings") return null;

  const onClick = resolveBackAction(route, {
    closeContactDetail,
    contactPayBackToChatId,
    navigateToMainReturn,
  });

  if (!onClick) return null;

  return {
    // A bank payment offer is dismissed rather than stepped out of, so it keeps
    // the close glyph instead of the back chevron.
    icon: route.kind === "bankPaymentOffer" ? "X" : "ChevronLeft",
    label: t("close"),
    onClick,
  };
};

// Routes whose right button is decided above are narrowed away before the
// lookup, so adding a route kind forces a decision here.
const SHOWS_MENU_BUTTON: Record<
  Exclude<Route["kind"], "chat" | "contact" | "contactNew" | "topup">,
  boolean
> = {
  advanced: false,
  advancedAutoPayLimit: false,
  advancedInspector: false,
  advancedInspectorTimeline: false,
  advancedPushDebug: false,
  bankPayment: false,
  bankPaymentNew: false,
  bankPaymentOffer: false,
  cashuToken: false,
  cashuTokenEmit: false,
  cashuTokenNew: false,
  cashuTokens: false,
  cashuProofs: false,
  contactEdit: false,
  contactPay: true,
  contacts: false,
  chatStorage: false,
  evoluCurrentData: false,
  evoluData: false,
  evoluHistoryData: false,
  evoluServer: true,
  evoluServerNew: true,
  keryxAnnouncement: false,
  keryxCompanies: false,
  keryxCompany: false,
  keryxCompanyNew: false,
  lnAddressPay: true,
  manualPay: false,
  mint: true,
  mintNew: false,
  mints: false,
  nostrRelay: true,
  nostrRelayNew: true,
  relays: false,
  profile: false,
  profileEdit: false,
  settings: false,
  settingsLanguage: false,
  settingsAppearance: false,
  settingsMasterKeys: false,
  proxyPayments: false,
  settingsReceiveMethod: false,
  settingsUnits: false,
  topupInvoice: false,
  topupNoAmount: false,
  transactions: false,
  recurringPaymentNew: false,
  recurringPayment: false,
  recurringPaymentEdit: false,
  wallet: false,
};

export const buildTopbarRight = ({
  chatEditContactId,
  contactsFilterIsActive,
  hiddenTransactionsShown,
  isProfileEditing,
  openReceiveScan,
  openScan,
  route,
  t,
  toggleContactsFilter,
  toggleHiddenTransactions,
  openMenu,
}: BuildTopbarRightArgs): TopbarButton | null => {
  if (route.kind === "contacts") {
    return {
      icon: "Filter",
      isActive: contactsFilterIsActive,
      label: t("contactsFilterToggle"),
      onClick: toggleContactsFilter,
    };
  }

  if (route.kind === "transactions") {
    return {
      icon: hiddenTransactionsShown ? "Eye" : "EyeOff",
      isActive: hiddenTransactionsShown,
      label: t(
        hiddenTransactionsShown
          ? "transactionsHideHidden"
          : "transactionsShowHidden",
      ),
      onClick: toggleHiddenTransactions,
    };
  }

  if (route.kind === "profile" && !isProfileEditing) {
    return {
      icon: "Pencil",
      label: t("edit"),
      onClick: () => navigateTo({ route: "profileEdit" }),
    };
  }

  if (route.kind === "chat") {
    if (!chatEditContactId) return null;
    return {
      icon: "Pencil",
      label: t("edit"),
      onClick: () =>
        navigateTo({ route: "contactEdit", id: chatEditContactId }),
    };
  }

  if (route.kind === "contact") {
    return {
      icon: "Pencil",
      label: t("editContact"),
      onClick: () => navigateTo({ route: "contactEdit", id: route.id }),
    };
  }

  if (route.kind === "recurringPayment") {
    return {
      icon: "Pencil",
      label: t("edit"),
      onClick: () =>
        navigateTo({ route: "recurringPaymentEdit", id: route.id }),
    };
  }

  if (route.kind === "bankPayment") {
    if (route.editing) return null;
    return {
      icon: "Pencil",
      label: t("spdPaymentEditFields"),
      onClick: () =>
        navigateTo({
          route: "bankPayment",
          spdPayload: route.spdPayload,
          editing: true,
        }),
    };
  }

  if (route.kind === "contactNew") {
    return {
      icon: "ScanLine",
      label: t("contactLoadQr"),
      onClick: openScan,
    };
  }

  if (route.kind === "topup") {
    return {
      icon: "ScanLine",
      label: t("scan"),
      onClick: openReceiveScan,
    };
  }

  return SHOWS_MENU_BUTTON[route.kind]
    ? { icon: "Settings", label: t("menu"), onClick: openMenu }
    : null;
};

const TOPBAR_TITLE_KEY: Record<Route["kind"], I18nKey> = {
  advanced: "settings",
  advancedAutoPayLimit: "lightningInvoiceAutoPayLimit",
  advancedInspector: "nostrInspector",
  advancedInspectorTimeline: "nostrInspector",
  advancedPushDebug: "pushDebug",
  bankPayment: "spdPaymentTitle",
  bankPaymentNew: "spdPaymentTitle",
  bankPaymentOffer: "bankPaymentOfferIncomingTitle",
  cashuToken: "cashuToken",
  cashuTokenEmit: "cashuEmit",
  cashuTokenNew: "cashuAddToken",
  cashuTokens: "tokens",
  cashuProofs: "cashuInspectProofs",
  chat: "messagesTitle",
  contact: "contact",
  contactEdit: "contactEditTitle",
  contactNew: "newContact",
  contactPay: "contactPayTitle",
  contacts: "contactsTitle",
  chatStorage: "chatStorage",
  evoluCurrentData: "evoluData",
  evoluData: "evoluStorage",
  evoluHistoryData: "evoluHistory",
  evoluServer: "evoluServer",
  evoluServerNew: "evoluAddServerLabel",
  keryxAnnouncement: "keryxAnnouncement",
  keryxCompanies: "keryxNewslettersTitle",
  keryxCompany: "keryxCompany",
  keryxCompanyNew: "keryxAddCompany",
  lnAddressPay: "pay",
  manualPay: "manualPayTitle",
  mint: "mints",
  mintNew: "mintAdd",
  mints: "mints",
  nostrRelay: "nostrRelay",
  nostrRelayNew: "addRelay",
  relays: "relays",
  profile: "profile",
  profileEdit: "profile",
  settings: "settings",
  settingsLanguage: "language",
  settingsAppearance: "appearance",
  settingsMasterKeys: "masterKeys",
  proxyPayments: "proxyPayments",
  settingsReceiveMethod: "receiveMethod",
  settingsUnits: "unit",
  topup: "topupTitle",
  topupInvoice: "topupInvoiceTitle",
  topupNoAmount: "topupNoAmountTitle",
  transactions: "transactionsTitle",
  recurringPaymentNew: "recurringPaymentNewTitle",
  recurringPayment: "recurringPaymentTitle",
  recurringPaymentEdit: "recurringPaymentEditTitle",
  wallet: "wallet",
};

export const buildTopbarTitle = (route: Route, t: Translate): string =>
  t(TOPBAR_TITLE_KEY[route.kind]);
