import { useEffect, useState } from "react";
import type { CashuTokenId, ContactId } from "../evolu";
import {
  BANK_PAYMENT_EDIT_SUFFIX,
  parseRouteFromHash,
  type Route,
} from "../types/route";

export const NATIVE_BACK_BUTTON_EVENT = "linky-native-back-button";
const BANK_PAYMENT_OFFER_RETURN_HASH_KEY =
  "linky.bank_payment_offer_return_hash.v1";

const rememberBankPaymentOfferReturnHash = (): void => {
  const currentRoute = parseRouteFromHash();
  if (currentRoute.kind === "bankPaymentOffer") return;
  if (
    currentRoute.kind !== "chat" &&
    currentRoute.kind !== "contacts" &&
    currentRoute.kind !== "wallet"
  ) {
    return;
  }

  try {
    const returnHash =
      currentRoute.kind === "wallet"
        ? "#wallet"
        : currentRoute.kind === "contacts"
          ? "#contacts"
          : window.location.hash;
    window.sessionStorage.setItem(
      BANK_PAYMENT_OFFER_RETURN_HASH_KEY,
      returnHash,
    );
  } catch {
    // Session storage can be unavailable in privacy-restricted browsers.
  }
};

export const returnFromBankPaymentOffer = (fallbackChatId: string): void => {
  let returnHash = "";
  try {
    returnHash =
      window.sessionStorage.getItem(BANK_PAYMENT_OFFER_RETURN_HASH_KEY) ?? "";
    window.sessionStorage.removeItem(BANK_PAYMENT_OFFER_RETURN_HASH_KEY);
  } catch {
    // Fall back to the related chat when session storage is unavailable.
  }

  const normalizedReturnHash = returnHash.trim();
  if (
    normalizedReturnHash === "#contacts" ||
    normalizedReturnHash === "#wallet" ||
    (normalizedReturnHash.startsWith("#chat/") &&
      !normalizedReturnHash.includes("/bank-payment-offer/"))
  ) {
    window.location.assign(normalizedReturnHash);
    return;
  }

  navigateTo({ route: "chat", id: fallbackChatId });
};

export const useRouting = () => {
  const [route, setRoute] = useState<Route>(() => parseRouteFromHash());

  useEffect(() => {
    const onHashChange = () => setRoute(parseRouteFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // The native back press is handled by `useNativeBackHandler`, which walks the
  // route hierarchy instead of the browser history. See its doc comment for why
  // `history.back()` is not usable here.

  return route;
};

// Navigation types
type NavigationAction =
  | { route: "advanced" }
  | { route: "advancedAutoPayLimit" }
  | { route: "advancedInspector" }
  | { route: "advancedInspectorTimeline" }
  | { route: "advancedPushDebug" }
  | { route: "cashuTokenEmit" }
  | { route: "cashuToken"; id: CashuTokenId }
  | { route: "cashuTokenNew" }
  | { route: "cashuTokens" }
  | { route: "chat"; id: string }
  | { route: "contact"; id: ContactId }
  | { route: "contactEdit"; id: ContactId }
  | { route: "contactNew" }
  | { route: "contactPay"; id: ContactId }
  | { route: "contacts" }
  | { route: "evoluCurrentData" }
  | { route: "evoluData" }
  | { route: "evoluHistoryData" }
  | { route: "evoluServer"; id: string }
  | { route: "evoluServerNew" }
  | { route: "evoluServers" }
  | { route: "lnAddressPay"; lnAddress: string }
  | { route: "manualPay" }
  | { route: "bankPayment"; spdPayload: string; editing?: boolean }
  | { route: "bankPaymentOffer"; chatId: string; offerId: string }
  | { route: "mint"; mintUrl: string }
  | { route: "mints" }
  | { route: "nostrRelay"; id: string }
  | { route: "nostrRelayNew" }
  | { route: "nostrRelays" }
  | { route: "profile" }
  | { route: "profileEdit" }
  | { route: "settings" }
  | { route: "settingsLanguage" }
  | { route: "settingsMasterKeys" }
  | { route: "settingsUnits" }
  | { route: "transactions" }
  | { route: "topup" }
  | { route: "topupNoAmount" }
  | { route: "topupInvoice" }
  | { route: "wallet" };

export const navigateTo = (action: NavigationAction): void => {
  switch (action.route) {
    case "contacts":
      window.location.assign("#contacts");
      break;
    case "settings":
      window.location.assign("#settings");
      break;
    case "settingsLanguage":
      window.location.assign("#settings/language");
      break;
    case "settingsUnits":
      window.location.assign("#settings/units");
      break;
    case "settingsMasterKeys":
      window.location.assign("#settings/master-keys");
      break;
    case "advanced":
      window.location.assign("#advanced");
      break;
    case "advancedAutoPayLimit":
      window.location.assign("#advanced/auto-pay-limit");
      break;
    case "advancedInspector":
      window.location.assign("#advanced/inspector");
      break;
    case "advancedInspectorTimeline":
      window.location.assign("#advanced/inspector/timeline");
      break;
    case "advancedPushDebug":
      window.location.assign("#advanced/push-debug");
      break;
    case "mints":
      window.location.assign("#advanced/mints");
      break;
    case "mint":
      window.location.assign(
        `#advanced/mint/${encodeURIComponent(action.mintUrl.trim())}`,
      );
      break;
    case "contact":
      window.location.assign(`#contact/${encodeURIComponent(action.id)}`);
      break;
    case "contactEdit":
      window.location.assign(`#contact/${encodeURIComponent(action.id)}/edit`);
      break;
    case "contactPay":
      window.location.assign(`#contact/${encodeURIComponent(action.id)}/pay`);
      break;
    case "chat":
      window.location.assign(`#chat/${encodeURIComponent(action.id)}`);
      break;
    case "contactNew":
      window.location.assign("#contact/new");
      break;
    case "wallet":
      window.location.assign("#wallet");
      break;
    case "transactions":
      window.location.assign("#wallet/transactions");
      break;
    case "topup":
      window.location.assign("#wallet/topup");
      break;
    case "topupNoAmount":
      window.location.assign("#wallet/topup/no-amount");
      break;
    case "topupInvoice":
      window.location.assign("#wallet/topup/invoice");
      break;
    case "cashuTokens":
      window.location.assign("#wallet/tokens");
      break;
    case "lnAddressPay":
      window.location.assign(`#payln/${encodeURIComponent(action.lnAddress)}`);
      break;
    case "manualPay":
      window.location.assign("#wallet/pay");
      break;
    case "bankPayment":
      window.location.assign(
        `#wallet/bank-payment/${encodeURIComponent(action.spdPayload.trim())}${action.editing ? BANK_PAYMENT_EDIT_SUFFIX : ""}`,
      );
      break;
    case "bankPaymentOffer":
      rememberBankPaymentOfferReturnHash();
      window.location.assign(
        `#chat/${encodeURIComponent(action.chatId.trim())}/bank-payment-offer/${encodeURIComponent(action.offerId.trim())}`,
      );
      break;
    case "cashuTokenNew":
      window.location.assign("#wallet/token/new");
      break;
    case "cashuTokenEmit":
      window.location.assign("#wallet/token/emit");
      break;
    case "cashuToken":
      window.location.assign(`#wallet/token/${encodeURIComponent(action.id)}`);
      break;
    case "profile":
      window.location.assign("#profile");
      break;
    case "profileEdit":
      window.location.assign("#profile/edit");
      break;
    case "nostrRelays":
      window.location.assign("#nostr-relays");
      break;
    case "nostrRelay":
      window.location.assign(`#nostr-relay/${encodeURIComponent(action.id)}`);
      break;
    case "nostrRelayNew":
      window.location.assign("#nostr-relay/new");
      break;
    case "evoluServers":
      window.location.assign("#evolu-servers");
      break;
    case "evoluData":
      window.location.assign("#evolu-data");
      break;
    case "evoluCurrentData":
      window.location.assign("#evolu-current-data");
      break;
    case "evoluHistoryData":
      window.location.assign("#evolu-history-data");
      break;
    case "evoluServer":
      window.location.assign(`#evolu-server/${encodeURIComponent(action.id)}`);
      break;
    case "evoluServerNew":
      window.location.assign("#evolu-server/new");
      break;
  }
};
