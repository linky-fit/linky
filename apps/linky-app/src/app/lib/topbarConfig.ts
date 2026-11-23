import type { Pubkey } from "@linky-fit/linkstr";
import type { OnchainTransferDirection } from "@linky-fit/onchain-transfer";
import type { ContactId } from "../../evolu";
import { navigateTo, returnFromBankPaymentOffer } from "../../hooks/useRouting";
import type { Route } from "../../types/route";
import { setBankPaymentOfferMinimized } from "./bankPaymentOfferStorage";
import { ONCHAIN_TRANSFER_TITLE_KEYS } from "./onchainTransferLabels";
import type { TopbarButton } from "../types/appTypes";
import type { I18nKey, Translate } from "../../i18n";

export interface BackActionContext {
  backFromContactNew: () => void;
  cashuTokensBackTo?: "advanced" | null;
  clearCashuTokensBackTo?: () => void;
  clearEvoluDataBackTo?: () => void;
  closeContactDetail: () => void;
  contactPayBackToChatId: ContactId | null;
  evoluDataBackTo?: "advanced" | null;
  navigateToMainReturn: () => void;
  ownPubkey: Pubkey | null;
  /** The chat holding the message a listing detail shows its copy from. */
  sharedListingChatId: string | null;
}

interface BuildTopbarArgs extends BackActionContext {
  route: Route;
  t: Translate;
}

interface BuildTopbarLeadingArgs {
  contactsFilterIsActive: boolean;
  isProfileEditing: boolean;
  route: Route;
  t: Translate;
  toggleContactsFilter: () => void;
}

interface BuildTopbarRightArgs {
  chatEditContactId: ContactId | null;
  deleteEditedContact: () => void;
  isProfileEditing: boolean;
  /** Opens the scanner for a contact's code. */
  openContactScan: () => void;
  openReceiveScan: () => void;
  /** Opens the scanner for payments, which reads contact codes too. */
  openWalletScan: () => void;
  route: Route;
  t: Translate;
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
    backFromContactNew,
    cashuTokensBackTo = null,
    clearCashuTokensBackTo,
    clearEvoluDataBackTo,
    closeContactDetail,
    contactPayBackToChatId,
    evoluDataBackTo = null,
    navigateToMainReturn,
    ownPubkey,
    sharedListingChatId,
  }: BackActionContext,
): (() => void) | null => {
  switch (route.kind) {
    case "settings":
    case "profile":
      return navigateToMainReturn;

    case "advanced":
    case "settingsLanguage":
    case "settingsAppearance":
    case "settingsUnits":
    case "settingsTutorial":
    case "settingsSupport":
    case "settingsWhatsNew":
    case "settingsBlocked":
    case "settingsReceiveMethod":
    case "settingsMasterKeys":
    case "settingsNostrIdentity":
    case "advancedAutoPayLimit":
    case "mints":
    case "nostrRelays":
    case "evoluServers":
      return () => navigateTo({ route: "settings" });

    case "advancedInspector":
    case "advancedPushDebug":
      return () => navigateTo({ route: "advanced" });

    case "bankPaymentNew":
      return () => navigateTo({ route: "proxyPayments" });

    case "proxyPayments":
    case "cash":
    case "listings":
      return () => navigateTo({ route: "collaboration" });

    case "listingNew":
      return () => navigateTo({ route: "listings" });

    case "listing":
      return route.messageId && sharedListingChatId
        ? () => navigateTo({ route: "chat", id: sharedListingChatId })
        : () => navigateTo({ route: "listings" });

    case "listingEdit": {
      const listingId = route.id;
      return ownPubkey
        ? () => navigateTo({ route: "listing", author: ownPubkey, listingId })
        : () => navigateTo({ route: "listings" });
    }

    case "advancedInspectorTimeline":
      return () => navigateTo({ route: "advancedInspector" });

    case "mint":
    case "mintNew":
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

    case "cashuTokens":
      return () => {
        clearCashuTokensBackTo?.();
        navigateTo({
          route: cashuTokensBackTo === "advanced" ? "advanced" : "wallet",
        });
      };

    case "manualPay":
    case "lnInvoicePay":
    case "cashuTokenEmit":
    case "topup":
    case "onchainSend":
      return () => navigateTo({ route: "wallet" });

    case "walletHistory":
    case "onchainTransfer":
      return () => navigateTo({ route: "wallet" });
    case "recurringPaymentNew":
    case "recurringPayment":
    case "transaction":
      return () => navigateTo({ route: "walletHistory" });
    case "recurringPaymentEdit":
      return () => navigateTo({ route: "recurringPayment", id: route.id });

    case "topupNoAmount":
    case "topupInvoice":
    case "onchainReceive":
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

    case "lnAddressPay":
    case "chat":
      return () => navigateTo({ route: "contacts" });

    case "nostrRelay":
    case "nostrRelayNew":
      return () => navigateTo({ route: "nostrRelays" });

    case "evoluCurrentData":
      return () => {
        clearEvoluDataBackTo?.();
        navigateTo({
          route: evoluDataBackTo === "advanced" ? "advanced" : "evoluServers",
        });
      };

    case "evoluServer":
    case "evoluServerNew":
    case "chatStorage":
    case "evoluHistoryData":
      return () => navigateTo({ route: "evoluServers" });

    case "contactNew":
      return backFromContactNew;
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
    case "collaboration":
      return null;
  }
};

export const buildTopbar = ({
  route,
  t,
  ...context
}: BuildTopbarArgs): TopbarButton | null => {
  // Profile and settings are bottom-nav roots: no back chevron, although the
  // hardware back button still returns to the main screen.
  if (route.kind === "profile" || route.kind === "settings") return null;

  const onClick = resolveBackAction(route, context);

  if (!onClick) return null;

  // A bank payment offer is dismissed rather than stepped out of, so it keeps
  // the close glyph instead of the back chevron.
  const dismisses = route.kind === "bankPaymentOffer";
  return {
    icon: dismisses ? "X" : "ChevronLeft",
    label: t(dismisses ? "close" : "back"),
    onClick,
  };
};

/**
 * What a root screen shows where a back button would be: the contacts filter
 * and the profile's pencil. The scanner takes the right slot of every root
 * screen.
 */
export const buildTopbarLeading = ({
  contactsFilterIsActive,
  isProfileEditing,
  route,
  t,
  toggleContactsFilter,
}: BuildTopbarLeadingArgs): TopbarButton | null => {
  if (route.kind === "contacts") {
    return {
      icon: "Search",
      isActive: contactsFilterIsActive,
      label: t("contactsFilterToggle"),
      onClick: toggleContactsFilter,
    };
  }

  if (route.kind === "profile" && !isProfileEditing) {
    return {
      guide: "profile-edit",
      icon: "Pencil",
      label: t("edit"),
      onClick: () => navigateTo({ route: "profileEdit" }),
    };
  }

  return null;
};

export const buildTopbarRight = ({
  chatEditContactId,
  deleteEditedContact,
  isProfileEditing,
  openContactScan,
  openReceiveScan,
  openWalletScan,
  route,
  t,
}: BuildTopbarRightArgs): TopbarButton | null => {
  // Every root screen opens the scanner on the right. The profile and the
  // contacts read a contact's code; the others read payments as well.
  if (route.kind === "contacts" || route.kind === "profile") {
    if (isProfileEditing && route.kind === "profile") return null;
    return { icon: "ScanLine", label: t("scan"), onClick: openContactScan };
  }

  if (
    route.kind === "wallet" ||
    route.kind === "collaboration" ||
    route.kind === "proxyPayments" ||
    route.kind === "settings"
  ) {
    return { icon: "ScanLine", label: t("scan"), onClick: openWalletScan };
  }

  if (route.kind === "nostrRelays") {
    return {
      icon: "Plus",
      label: t("addRelay"),
      onClick: () => navigateTo({ route: "nostrRelayNew" }),
    };
  }

  if (route.kind === "evoluServers") {
    return {
      icon: "Plus",
      label: t("evoluAddServerLabel"),
      onClick: () => navigateTo({ route: "evoluServerNew" }),
    };
  }

  if (route.kind === "chat") {
    if (!chatEditContactId) return null;
    return {
      guide: "contact-edit",
      icon: "Pencil",
      label: t("edit"),
      onClick: () =>
        navigateTo({ route: "contactEdit", id: chatEditContactId }),
    };
  }

  if (route.kind === "contact") {
    return {
      guide: "contact-edit",
      icon: "Pencil",
      label: t("editContact"),
      onClick: () => navigateTo({ route: "contactEdit", id: route.id }),
    };
  }

  // Deleting runs on one click; the toast that follows offers to undo it.
  if (route.kind === "contactEdit") {
    return {
      icon: "Trash2",
      label: t("deleteContact"),
      onClick: deleteEditedContact,
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

  if (route.kind === "topup") {
    return {
      icon: "ScanLine",
      label: t("scan"),
      onClick: openReceiveScan,
    };
  }

  return null;
};

const TOPBAR_TITLE_KEY: Record<Route["kind"], I18nKey> = {
  advanced: "settingsDeveloper",
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
  cash: "cash",
  chat: "messagesTitle",
  collaboration: "collaboration",
  listings: "listings",
  listingNew: "listingNewTitle",
  listingEdit: "listingEditTitle",
  listing: "listingDetailTitle",
  contact: "contact",
  contactEdit: "contactEditTitle",
  contactNew: "newContact",
  contactPay: "contactPayTitle",
  contacts: "contactsTitle",
  chatStorage: "chatStorage",
  evoluCurrentData: "evoluData",
  evoluHistoryData: "evoluHistory",
  evoluServer: "evoluServer",
  evoluServerNew: "evoluAddServerLabel",
  evoluServers: "evoluServers",
  lnAddressPay: "pay",
  lnInvoicePay: "pay",
  manualPay: "manualPayTitle",
  mint: "mints",
  mintNew: "mintAdd",
  mints: "mints",
  nostrRelay: "nostrRelay",
  nostrRelayNew: "addRelay",
  nostrRelays: "nostrRelays",
  onchainReceive: "onchainReceiveTitle",
  onchainSend: "onchainSendTitle",
  onchainTransfer: "onchainTransferTitle",
  profile: "profile",
  profileEdit: "profileEditTitle",
  settings: "settings",
  settingsLanguage: "language",
  settingsAppearance: "appearance",
  settingsMasterKeys: "masterKeys",
  settingsNostrIdentity: "nostrIdentity",
  proxyPayments: "proxyPayments",
  settingsReceiveMethod: "receiveMethod",
  settingsTutorial: "tutorial",
  settingsSupport: "supportLinkyTitle",
  settingsWhatsNew: "whatsNew",
  settingsBlocked: "blocked",
  settingsUnits: "unit",
  topup: "topupTitle",
  topupInvoice: "topupInvoiceTitle",
  topupNoAmount: "topupNoAmountTitle",
  transaction: "transactionTitle",
  recurringPaymentNew: "recurringPaymentNewTitle",
  recurringPayment: "recurringPaymentTitle",
  recurringPaymentEdit: "recurringPaymentEditTitle",
  wallet: "wallet",
  walletHistory: "walletHistory",
};

/** The title of the route; an on-chain transfer is titled by its direction once that is known. */
export const buildTopbarTitle = (
  route: Route,
  t: Translate,
  onchainTransferDirection: OnchainTransferDirection | null = null,
): string =>
  route.kind === "onchainTransfer" && onchainTransferDirection !== null
    ? t(ONCHAIN_TRANSFER_TITLE_KEYS[onchainTransferDirection])
    : t(TOPBAR_TITLE_KEY[route.kind]);
