import { useSyncExternalStore } from "react";
import { encodeNpub, type Pubkey } from "@linky-fit/linkstr";
import type { MessageId, OnchainTransferId } from "@linky-fit/linksync";
import type { CashuOperationId, ContactId } from "../evolu";
import {
  safeSessionStorageGet,
  safeSessionStorageRemove,
  safeSessionStorageSet,
} from "../utils/storage";
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

  const returnHash =
    currentRoute.kind === "wallet"
      ? "#wallet"
      : currentRoute.kind === "contacts"
        ? "#contacts"
        : window.location.hash;
  safeSessionStorageSet(BANK_PAYMENT_OFFER_RETURN_HASH_KEY, returnHash);
};

export const returnFromBankPaymentOffer = (fallbackChatId: string): void => {
  const returnHash =
    safeSessionStorageGet(BANK_PAYMENT_OFFER_RETURN_HASH_KEY) ?? "";
  safeSessionStorageRemove(BANK_PAYMENT_OFFER_RETURN_HASH_KEY);

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

const routeListeners = new Set<() => void>();
let cachedHash: string | null = null;
let cachedExplicitEmptyHash: boolean | null = null;
let cachedRoute: Route | null = null;

const readRouteSnapshot = (): Route => {
  const hash = globalThis.location?.hash ?? "";
  const explicitEmptyHash = (globalThis.location?.href ?? "").endsWith("#");
  if (
    cachedRoute !== null &&
    cachedHash === hash &&
    cachedExplicitEmptyHash === explicitEmptyHash
  ) {
    return cachedRoute;
  }
  cachedHash = hash;
  cachedExplicitEmptyHash = explicitEmptyHash;
  cachedRoute = parseRouteFromHash();
  return cachedRoute;
};

const notifyRouteListeners = (): void => {
  readRouteSnapshot();
  for (const listener of routeListeners) listener();
};

const subscribeRoute = (listener: () => void): (() => void) => {
  if (routeListeners.size === 0) {
    window.addEventListener("hashchange", notifyRouteListeners);
  }
  routeListeners.add(listener);
  return () => {
    routeListeners.delete(listener);
    if (routeListeners.size === 0) {
      window.removeEventListener("hashchange", notifyRouteListeners);
    }
  };
};

// The native back press is handled by `useNativeBackHandler`, which walks the
// route hierarchy instead of the browser history. See its doc comment for why
// `history.back()` is not usable here.
export const useRouting = (): Route =>
  useSyncExternalStore(subscribeRoute, readRouteSnapshot);

// Navigation types
type NavigationAction =
  | { route: "advanced" }
  | { route: "advancedAutoPayLimit" }
  | { route: "advancedInspector" }
  | { route: "advancedInspectorTimeline" }
  | { route: "advancedPushDebug" }
  | { route: "cashuTokenEmit" }
  | { route: "cashuToken"; id: CashuOperationId }
  | { route: "cashuTokenNew" }
  | { route: "cashuTokens" }
  | { route: "cashuProofs" }
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
  | { route: "chatStorage" }
  | { route: "evoluServers" }
  | { route: "lnAddressPay"; lnAddress: string }
  | { route: "lnInvoicePay"; invoice: string }
  | { route: "manualPay" }
  | { route: "bankPayment"; spdPayload: string; editing?: boolean }
  | { route: "bankPaymentNew" }
  | { route: "bankPaymentOffer"; chatId: string; offerId: string }
  | { route: "mint"; mintUrl: string }
  | { route: "mints" }
  | { route: "mintNew" }
  | { route: "nostrRelay"; id: string }
  | { route: "nostrRelayNew" }
  | { route: "nostrRelays" }
  | { route: "profile" }
  | { route: "profileEdit" }
  | { route: "settings" }
  | { route: "settingsLanguage" }
  | { route: "settingsAppearance" }
  | { route: "settingsMasterKeys" }
  | { route: "settingsDevices" }
  | { route: "settingsNostrIdentity" }
  | { route: "proxyPayments" }
  | { route: "collaboration" }
  | { route: "cash" }
  | { route: "listings" }
  | { route: "listingNew" }
  | { route: "listingEdit"; id: string }
  | {
      route: "listing";
      author: Pubkey;
      listingId: string;
      messageId?: MessageId;
    }
  | { route: "settingsUnits" }
  | { route: "settingsTutorial" }
  | { route: "settingsSupport" }
  | { route: "settingsWhatsNew" }
  | { route: "settingsBlocked" }
  | { route: "settingsReceiveMethod" }
  | { route: "transaction"; id: string }
  | {
      route: "recurringPaymentNew";
      prefill?: { amountSat?: number; contactId?: string };
    }
  | { route: "recurringPayment"; id: string }
  | { route: "recurringPaymentEdit"; id: string }
  | { route: "topup" }
  /** A scanned bitcoin address or BIP21 URI fills the payout address, and its amount picks the transfer amount. */
  | { route: "onchainSend"; payoutAddress?: string; amount?: number }
  /** The amount the receive page holds starts the transfer. */
  | { route: "onchainReceive" }
  | { route: "onchainTransfer"; id: OnchainTransferId }
  | { route: "topupNoAmount" }
  | { route: "topupInvoice" }
  | { route: "wallet" }
  | { route: "walletHistory" };

/** Leaves the app for another page, such as the site a login came from. */
export const navigateAwayTo = (url: string): void => {
  window.location.assign(url);
};

/**
 * Opens a route. `replace` swaps the current history entry, as a tab switch
 * does, so the iOS back swipe never slides from one tab to another.
 */
export const navigateTo = (
  action: NavigationAction,
  { replace = false }: { replace?: boolean } = {},
): void => {
  const go = (hash: string) =>
    replace ? window.location.replace(hash) : window.location.assign(hash);
  switch (action.route) {
    case "contacts":
      go("#contacts");
      break;
    case "settings":
      go("#settings");
      break;
    case "settingsLanguage":
      go("#settings/language");
      break;
    case "settingsAppearance":
      go("#settings/appearance");
      break;
    case "settingsUnits":
      go("#settings/units");
      break;
    case "settingsTutorial":
      go("#settings/tutorial");
      break;
    case "settingsSupport":
      go("#settings/support");
      break;
    case "settingsWhatsNew":
      go("#settings/whats-new");
      break;
    case "settingsBlocked":
      go("#settings/blocked");
      break;
    case "settingsReceiveMethod":
      go("#settings/receive-method");
      break;
    case "settingsMasterKeys":
      go("#settings/master-keys");
      break;
    case "settingsDevices":
      go("#settings/devices");
      break;
    case "settingsNostrIdentity":
      go("#settings/nostr-identity");
      break;
    case "proxyPayments":
      go("#proxy");
      break;
    case "collaboration":
      go("#collaboration");
      break;
    case "cash":
      go("#collaboration/cash");
      break;
    case "listings":
      go("#collaboration/listings");
      break;
    case "listingNew":
      go("#collaboration/listings/new");
      break;
    case "listingEdit":
      go(`#collaboration/listings/${encodeURIComponent(action.id)}`);
      break;
    case "listing":
      go(
        `#collaboration/listings/${encodeNpub(action.author)}/${encodeURIComponent(action.listingId)}${action.messageId ? `/m/${encodeURIComponent(action.messageId)}` : ""}`,
      );
      break;
    case "advanced":
      go("#advanced");
      break;
    case "advancedAutoPayLimit":
      go("#advanced/auto-pay-limit");
      break;
    case "advancedInspector":
      go("#advanced/inspector");
      break;
    case "advancedInspectorTimeline":
      go("#advanced/inspector/timeline");
      break;
    case "advancedPushDebug":
      go("#advanced/push-debug");
      break;
    case "mints":
      go("#advanced/mints");
      break;
    case "mintNew":
      go("#advanced/mints/new");
      break;
    case "mint":
      go(`#advanced/mint/${encodeURIComponent(action.mintUrl.trim())}`);
      break;
    case "contact":
      go(`#contact/${encodeURIComponent(action.id)}`);
      break;
    case "contactEdit":
      go(`#contact/${encodeURIComponent(action.id)}/edit`);
      break;
    case "contactPay":
      go(`#contact/${encodeURIComponent(action.id)}/pay`);
      break;
    case "chat":
      go(`#chat/${encodeURIComponent(action.id)}`);
      break;
    case "contactNew":
      go("#contact/new");
      break;
    case "wallet":
      go("#wallet");
      break;
    case "walletHistory":
      go("#wallet/history");
      break;
    case "transaction":
      go(`#wallet/transactions/${encodeURIComponent(action.id)}`);
      break;
    case "recurringPaymentNew": {
      const query = new URLSearchParams();
      if (action.prefill?.contactId)
        query.set("contact", action.prefill.contactId);
      if (action.prefill?.amountSat) {
        query.set("amount", String(action.prefill.amountSat));
      }
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      go(`#wallet/recurring/new${suffix}`);
      break;
    }
    case "recurringPayment":
      go(`#wallet/recurring/${encodeURIComponent(action.id)}`);
      break;
    case "recurringPaymentEdit":
      go(`#wallet/recurring/${encodeURIComponent(action.id)}/edit`);
      break;
    case "topup":
      go("#wallet/topup");
      break;
    case "onchainSend": {
      const query = new URLSearchParams();
      if (action.payoutAddress) query.set("address", action.payoutAddress);
      if (action.amount) query.set("amount", String(action.amount));
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      go(`#wallet/onchain/send${suffix}`);
      break;
    }
    case "onchainReceive":
      go("#wallet/onchain/receive");
      break;
    case "onchainTransfer":
      go(`#wallet/onchain/${encodeURIComponent(action.id)}`);
      break;
    case "topupNoAmount":
      go("#wallet/topup/no-amount");
      break;
    case "topupInvoice":
      go("#wallet/topup/invoice");
      break;
    case "cashuProofs":
      go("#wallet/tokens/proofs");
      break;
    case "cashuTokens":
      go("#wallet/tokens");
      break;
    case "lnAddressPay":
      go(`#payln/${encodeURIComponent(action.lnAddress)}`);
      break;
    case "lnInvoicePay":
      go(`#payinvoice/${encodeURIComponent(action.invoice.trim())}`);
      break;
    case "manualPay":
      go("#wallet/pay");
      break;
    case "bankPayment":
      go(
        `#wallet/bank-payment/${encodeURIComponent(action.spdPayload.trim())}${action.editing ? BANK_PAYMENT_EDIT_SUFFIX : ""}`,
      );
      break;
    case "bankPaymentNew":
      go("#wallet/bank-payment/new");
      break;
    case "bankPaymentOffer":
      rememberBankPaymentOfferReturnHash();
      go(
        `#chat/${encodeURIComponent(action.chatId.trim())}/bank-payment-offer/${encodeURIComponent(action.offerId.trim())}`,
      );
      break;
    case "cashuTokenNew":
      go("#wallet/token/new");
      break;
    case "cashuTokenEmit":
      go("#wallet/token/emit");
      break;
    case "cashuToken":
      go(`#wallet/token/${encodeURIComponent(action.id)}`);
      break;
    case "profile":
      go("#profile");
      break;
    case "profileEdit":
      go("#profile/edit");
      break;
    case "nostrRelays":
      go("#nostr-relays");
      break;
    case "nostrRelay":
      go(`#nostr-relay/${encodeURIComponent(action.id)}`);
      break;
    case "nostrRelayNew":
      go("#nostr-relay/new");
      break;
    case "chatStorage":
      go("#advanced/chat-storage");
      return;
    case "evoluServers":
      go("#evolu-servers");
      break;
    case "evoluData":
      go("#evolu-data");
      break;
    case "evoluCurrentData":
      go("#evolu-current-data");
      break;
    case "evoluHistoryData":
      go("#evolu-history-data");
      break;
    case "evoluServer":
      go(`#evolu-server/${encodeURIComponent(action.id)}`);
      break;
    case "evoluServerNew":
      go("#evolu-server/new");
      break;
  }
};
