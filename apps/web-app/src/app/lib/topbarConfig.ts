import type { ContactId } from "../../evolu";
import { navigateTo, returnFromBankPaymentOffer } from "../../hooks/useRouting";
import type { Route } from "../../types/route";
import { setLinkyBankPaymentOfferMinimized } from "./bankPaymentOffer";
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
  isProfileEditing: boolean;
  openReceiveScan: () => void;
  openScan: () => void;
  route: Route;
  t: Translate;
  toggleMenu: () => void;
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
    case "settingsUnits":
    case "settingsMasterKeys":
    case "advancedAutoPayLimit":
    case "advancedInspector":
    case "mints":
    case "nostrRelays":
    case "evoluServers":
      return () => navigateTo({ route: "settings" });

    case "advancedInspectorTimeline":
    case "advancedPushDebug":
      return () => navigateTo({ route: "advancedInspector" });

    case "mint":
      return () => navigateTo({ route: "mints" });

    case "profileEdit":
      return () => navigateTo({ route: "profile" });

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

    case "topupNoAmount":
    case "topupInvoice":
      return () => navigateTo({ route: "topup" });

    case "bankPaymentOffer": {
      const { chatId, offerId } = route;
      return () => {
        setLinkyBankPaymentOfferMinimized(chatId, offerId, true);
        returnFromBankPaymentOffer(chatId);
      };
    }

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
      return () => navigateTo({ route: "nostrRelays" });

    case "evoluServer":
    case "evoluServerNew":
    case "evoluCurrentData":
    case "evoluHistoryData":
      return () => navigateTo({ route: "evoluServers" });

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
  const onClick = resolveBackAction(route, {
    closeContactDetail,
    contactPayBackToChatId,
    navigateToMainReturn,
  });

  if (!onClick) return null;

  return {
    // A bank payment offer is dismissed rather than stepped out of, so it keeps
    // the close glyph instead of the back chevron.
    icon: route.kind === "bankPaymentOffer" ? "×" : "<",
    label: t("close"),
    onClick,
  };
};

// Routes whose right button is decided above are narrowed away before the
// lookup, so adding a route kind forces a decision here.
const SHOWS_MENU_BUTTON: Record<
  Exclude<
    Route["kind"],
    "chat" | "contact" | "contactNew" | "evoluServers" | "nostrRelays" | "topup"
  >,
  boolean
> = {
  advanced: false,
  advancedAutoPayLimit: false,
  advancedInspector: false,
  advancedInspectorTimeline: false,
  advancedPushDebug: false,
  bankPayment: false,
  bankPaymentOffer: false,
  cashuToken: false,
  cashuTokenEmit: false,
  cashuTokenNew: false,
  cashuTokens: false,
  contactEdit: false,
  contactPay: true,
  contacts: true,
  evoluCurrentData: false,
  evoluData: false,
  evoluHistoryData: false,
  evoluServer: true,
  evoluServerNew: true,
  lnAddressPay: true,
  manualPay: false,
  mint: true,
  mints: false,
  nostrRelay: true,
  nostrRelayNew: true,
  profile: true,
  profileEdit: false,
  settings: false,
  settingsLanguage: false,
  settingsMasterKeys: false,
  settingsUnits: false,
  topupInvoice: false,
  topupNoAmount: false,
  transactions: false,
  wallet: true,
};

export const buildTopbarRight = ({
  chatEditContactId,
  isProfileEditing,
  openReceiveScan,
  openScan,
  route,
  t,
  toggleMenu,
}: BuildTopbarRightArgs): TopbarButton | null => {
  if (route.kind === "nostrRelays") {
    return {
      icon: "+",
      label: t("addRelay"),
      onClick: () => navigateTo({ route: "nostrRelayNew" }),
    };
  }

  if (route.kind === "evoluServers") {
    return {
      icon: "+",
      label: t("evoluAddServerLabel"),
      onClick: () => navigateTo({ route: "evoluServerNew" }),
    };
  }

  if (route.kind === "profile" && !isProfileEditing) {
    return {
      icon: "edit",
      label: t("edit"),
      onClick: () => navigateTo({ route: "profileEdit" }),
    };
  }

  if (route.kind === "chat") {
    if (!chatEditContactId) return null;
    return {
      icon: "edit",
      label: t("edit"),
      onClick: () =>
        navigateTo({ route: "contactEdit", id: chatEditContactId }),
    };
  }

  if (route.kind === "contact") {
    return {
      icon: "edit",
      label: t("editContact"),
      onClick: () => navigateTo({ route: "contactEdit", id: route.id }),
    };
  }

  if (route.kind === "bankPayment") {
    if (route.editing) return null;
    return {
      icon: "edit",
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
      icon: "scan",
      label: t("contactLoadQr"),
      onClick: openScan,
    };
  }

  if (route.kind === "topup") {
    return {
      icon: "scan",
      label: t("scan"),
      onClick: openReceiveScan,
    };
  }

  return SHOWS_MENU_BUTTON[route.kind]
    ? { icon: "☰", label: t("menu"), onClick: toggleMenu }
    : null;
};

const TOPBAR_TITLE_KEY: Record<
  Exclude<Route["kind"], "advancedPushDebug">,
  I18nKey
> = {
  advanced: "settings",
  advancedAutoPayLimit: "lightningInvoiceAutoPayLimit",
  advancedInspector: "nostrInspector",
  advancedInspectorTimeline: "nostrInspector",
  bankPayment: "spdPaymentTitle",
  bankPaymentOffer: "bankPaymentOfferIncomingTitle",
  cashuToken: "cashuToken",
  cashuTokenEmit: "cashuEmit",
  cashuTokenNew: "cashuAddToken",
  cashuTokens: "tokens",
  chat: "messagesTitle",
  contact: "contact",
  contactEdit: "contactEditTitle",
  contactNew: "newContact",
  contactPay: "contactPayTitle",
  contacts: "contactsTitle",
  evoluCurrentData: "evoluData",
  evoluData: "evoluData",
  evoluHistoryData: "evoluHistory",
  evoluServer: "evoluServer",
  evoluServerNew: "evoluAddServerLabel",
  evoluServers: "evoluServer",
  lnAddressPay: "pay",
  manualPay: "manualPayTitle",
  mint: "mints",
  mints: "mints",
  nostrRelay: "nostrRelay",
  nostrRelayNew: "nostrRelay",
  nostrRelays: "nostrRelay",
  profile: "profile",
  profileEdit: "profile",
  settings: "settings",
  settingsLanguage: "language",
  settingsMasterKeys: "masterKeys",
  settingsUnits: "unit",
  topup: "topupTitle",
  topupInvoice: "topupInvoiceTitle",
  topupNoAmount: "topupNoAmountTitle",
  transactions: "transactionsTitle",
  wallet: "wallet",
};

export const buildTopbarTitle = (route: Route, t: Translate): string => {
  if (route.kind === "advancedPushDebug") return "Push Debug";
  return t(TOPBAR_TITLE_KEY[route.kind]);
};
