import type { Route } from "../../types/route";

export type DesktopRouteSection = "contacts" | "wallet" | "proxy" | "settings";

/** The root route each section opens on. */
export const getDesktopSectionRoute = (
  section: DesktopRouteSection,
): "contacts" | "wallet" | "proxyPayments" | "settings" =>
  section === "proxy" ? "proxyPayments" : section;

export const getDesktopRouteSection = (route: Route): DesktopRouteSection => {
  switch (route.kind) {
    case "wallet":
    case "transactions":
    case "topup":
    case "topupNoAmount":
    case "topupInvoice":
    case "manualPay":
    case "bankPayment":
    case "lnAddressPay":
      return "wallet";

    case "proxyPayments":
    case "bankPaymentNew":
      return "proxy";

    case "settings":
    case "settingsLanguage":
    case "settingsAppearance":
    case "settingsUnits":
    case "settingsReceiveMethod":
    case "settingsMasterKeys":
    case "advanced":
    case "advancedAutoPayLimit":
    case "advancedInspector":
    case "advancedInspectorTimeline":
    case "advancedPushDebug":
    case "mints":
    case "mintNew":
    case "mint":
    case "nostrRelays":
    case "nostrRelay":
    case "nostrRelayNew":
    case "chatStorage":
    case "evoluServers":
    case "evoluServer":
    case "evoluServerNew":
    case "evoluData":
    case "evoluCurrentData":
    case "evoluHistoryData":
    case "cashuProofs":
    case "cashuTokens":
    case "cashuTokenNew":
    case "cashuTokenEmit":
    case "cashuToken":
      return "settings";

    case "contacts":
    case "contactNew":
    case "contact":
    case "contactEdit":
    case "contactPay":
    case "bankPaymentOffer":
    case "chat":
    case "profile":
    case "profileEdit":
      return "contacts";
  }
};

export const isDesktopSectionRoot = (route: Route): boolean =>
  route.kind === "contacts" ||
  route.kind === "wallet" ||
  route.kind === "proxyPayments" ||
  route.kind === "settings" ||
  route.kind === "advanced";

export const isDesktopSectionEntryRoute = (route: Route): boolean => {
  switch (route.kind) {
    case "contactNew":
    case "contact":
    case "chat":
    case "profile":
    case "transactions":
    case "topup":
    case "manualPay":
    case "bankPayment":
    case "bankPaymentNew":
    case "lnAddressPay":
    case "settingsLanguage":
    case "settingsAppearance":
    case "settingsUnits":
    case "settingsReceiveMethod":
    case "settingsMasterKeys":
    case "advancedAutoPayLimit":
    case "advancedInspector":
    case "mints":
    case "nostrRelays":
    case "chatStorage":
    case "evoluServers":
    case "evoluData":
    case "cashuTokens":
      return true;

    default:
      return false;
  }
};

export const getDesktopActiveContactId = (route: Route): string | null => {
  switch (route.kind) {
    case "contact":
    case "contactEdit":
    case "contactPay":
      return route.id;

    case "chat":
      return route.id;

    case "bankPaymentOffer":
      return route.chatId;

    default:
      return null;
  }
};
