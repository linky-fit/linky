import {
  CashuOperationId,
  ContactId,
  KeryxSubscriptionId,
  RecurringPaymentId,
} from "@linky-fit/linksync";
import { UNKNOWN_CONTACT_ID_PREFIX } from "../utils/constants";

const decodeSegment = (value: string): string | null => {
  try {
    return decodeURIComponent(value).trim() || null;
  } catch {
    return null;
  }
};

export const BANK_PAYMENT_EDIT_SUFFIX = "/edit";

const decodePrefixedSegment = (path: string, prefix: string): string | null =>
  path.startsWith(prefix) ? decodeSegment(path.slice(prefix.length)) : null;

const parseCashuTokenId = (value: string): CashuOperationId | null => {
  const result = CashuOperationId.fromUnknown(value);
  return result.ok ? result.value : null;
};

const parseContactId = (value: string): ContactId | null => {
  const result = ContactId.fromUnknown(value);
  return result.ok ? result.value : null;
};

export type Route =
  | { kind: "contacts" }
  | { kind: "settings" }
  | { kind: "settingsLanguage" }
  | { kind: "settingsAppearance" }
  | { kind: "settingsUnits" }
  | { kind: "settingsTutorial" }
  | { kind: "settingsBlocked" }
  | { kind: "settingsReceiveMethod" }
  | { kind: "settingsMasterKeys" }
  | { kind: "settingsNostrIdentity" }
  | { kind: "keryxCompanies" }
  | { kind: "keryxCompanyNew" }
  | { kind: "keryxCompany"; id: KeryxSubscriptionId }
  | { kind: "keryxAnnouncement"; id: KeryxSubscriptionId; key: string }
  | { kind: "proxyPayments" }
  | { kind: "advanced" }
  | { kind: "advancedAutoPayLimit" }
  | { kind: "advancedInspector" }
  | { kind: "advancedInspectorTimeline" }
  | { kind: "advancedPushDebug" }
  | { kind: "mints" }
  | { kind: "mintNew" }
  | { kind: "mint"; mintUrl: string }
  | { kind: "profile" }
  | { kind: "profileEdit" }
  | { kind: "wallet" }
  | { kind: "transactions" }
  | { kind: "recurringPaymentNew" }
  | { kind: "recurringPayment"; id: RecurringPaymentId }
  | { kind: "recurringPaymentEdit"; id: RecurringPaymentId }
  | { kind: "topup" }
  | { kind: "topupNoAmount" }
  | { kind: "topupInvoice" }
  | { kind: "manualPay" }
  | { kind: "bankPayment"; spdPayload: string; editing?: true }
  | { kind: "bankPaymentNew" }
  | { kind: "lnAddressPay"; lnAddress: string }
  | { kind: "cashuTokens" }
  | { kind: "cashuProofs" }
  | { kind: "cashuTokenNew" }
  | { kind: "cashuTokenEmit" }
  | { kind: "cashuToken"; id: CashuOperationId }
  | { kind: "nostrRelays" }
  | { kind: "nostrRelay"; id: string }
  | { kind: "nostrRelayNew" }
  | { kind: "chatStorage" }
  | { kind: "evoluServers" }
  | { kind: "evoluServer"; id: string }
  | { kind: "evoluServerNew" }
  | { kind: "evoluData" }
  | { kind: "evoluCurrentData" }
  | { kind: "evoluHistoryData" }
  | { kind: "contactNew" }
  | { kind: "contact"; id: ContactId }
  | { kind: "contactEdit"; id: ContactId }
  | { kind: "contactPay"; id: ContactId }
  | { kind: "bankPaymentOffer"; chatId: string; offerId: string }
  | { kind: "chat"; id: string };

/** Parses a route path such as `chat/abc` (no leading `#` or `/`); its query is ignored. */
export const parseRoutePath = (routePath: string): Route => {
  const path = routePath.split("?")[0] ?? routePath;
  if (path === "") return { kind: "wallet" };
  if (path === "contacts") return { kind: "contacts" };
  // The `#add/<npub>` shared-profile link is taken out of the hash once the app starts.
  if (path.startsWith("add/")) return { kind: "contacts" };
  if (path === "settings") return { kind: "settings" };
  if (path === "settings/language") return { kind: "settingsLanguage" };
  if (path === "settings/appearance") return { kind: "settingsAppearance" };
  if (path === "settings/units") return { kind: "settingsUnits" };
  if (path === "settings/tutorial") return { kind: "settingsTutorial" };
  if (path === "settings/blocked") return { kind: "settingsBlocked" };
  if (path === "settings/receive-method") {
    return { kind: "settingsReceiveMethod" };
  }
  if (path === "settings/master-keys") return { kind: "settingsMasterKeys" };
  if (path === "settings/nostr-identity") {
    return { kind: "settingsNostrIdentity" };
  }
  if (path === "settings/keryx") return { kind: "keryxCompanies" };
  if (path === "settings/keryx/new") return { kind: "keryxCompanyNew" };
  const keryxPrefix = "settings/keryx/";
  if (path.startsWith(keryxPrefix)) {
    const [rawId, rawKey] = path.slice(keryxPrefix.length).split("/");
    const id = KeryxSubscriptionId.fromUnknown(decodeSegment(rawId ?? ""));
    const key = decodeSegment(rawKey ?? "");
    if (id.ok) {
      return key
        ? { kind: "keryxAnnouncement", id: id.value, key }
        : { kind: "keryxCompany", id: id.value };
    }
  }
  // The old settings path stays parseable for links already shared.
  if (path === "proxy" || path === "settings/proxy-payments") {
    return { kind: "proxyPayments" };
  }
  if (path === "advanced") return { kind: "advanced" };
  if (path === "advanced/auto-pay-limit") {
    return { kind: "advancedAutoPayLimit" };
  }
  if (path === "advanced/inspector") {
    return { kind: "advancedInspector" };
  }
  if (path === "advanced/inspector/timeline") {
    return { kind: "advancedInspectorTimeline" };
  }
  if (path === "advanced/push-debug") {
    return { kind: "advancedPushDebug" };
  }
  if (path === "advanced/mints") return { kind: "mints" };
  if (path === "advanced/mints/new") return { kind: "mintNew" };

  const mintPrefix = "advanced/mint/";
  const mintUrl = decodePrefixedSegment(path, mintPrefix);
  if (mintUrl) return { kind: "mint", mintUrl };
  if (path === "profile/claim-lightning") {
    return { kind: "profileEdit" };
  }
  if (path === "profile/edit") return { kind: "profileEdit" };
  if (path === "profile") return { kind: "profile" };
  if (path === "wallet") return { kind: "wallet" };
  if (path === "wallet/transactions") return { kind: "transactions" };
  if (path === "wallet/recurring/new") return { kind: "recurringPaymentNew" };
  const recurringPrefix = "wallet/recurring/";
  if (path.startsWith(recurringPrefix)) {
    const [rawId, rawSub] = path.slice(recurringPrefix.length).split("/");
    const id = RecurringPaymentId.fromUnknown(decodeSegment(rawId ?? ""));
    if (id.ok) {
      return (rawSub ?? "") === "edit"
        ? { kind: "recurringPaymentEdit", id: id.value }
        : { kind: "recurringPayment", id: id.value };
    }
  }
  if (path === "wallet/topup") return { kind: "topup" };
  if (path === "wallet/topup/no-amount") return { kind: "topupNoAmount" };
  if (path === "wallet/topup/invoice") return { kind: "topupInvoice" };
  if (path === "wallet/pay") return { kind: "manualPay" };
  if (path === "wallet/bank-payment/new") return { kind: "bankPaymentNew" };

  const bankPaymentPrefix = "wallet/bank-payment/";
  if (path.startsWith(bankPaymentPrefix)) {
    const editing = path.endsWith(BANK_PAYMENT_EDIT_SUFFIX);
    const spdPayload = decodeSegment(
      path.slice(
        bankPaymentPrefix.length,
        editing ? -BANK_PAYMENT_EDIT_SUFFIX.length : undefined,
      ),
    );
    if (spdPayload) {
      return editing
        ? { kind: "bankPayment", spdPayload, editing: true }
        : { kind: "bankPayment", spdPayload };
    }
  }

  if (path === "wallet/tokens/proofs") return { kind: "cashuProofs" };
  if (path === "wallet/tokens") return { kind: "cashuTokens" };

  const payLnPrefix = "payln/";
  const lnAddress = decodePrefixedSegment(path, payLnPrefix);
  if (lnAddress) return { kind: "lnAddressPay", lnAddress };
  if (path === "wallet/token/new") return { kind: "cashuTokenNew" };
  if (path === "wallet/token/emit") return { kind: "cashuTokenEmit" };

  const walletTokenPrefix = "wallet/token/";
  const cashuTokenIdText = decodePrefixedSegment(path, walletTokenPrefix);
  if (cashuTokenIdText) {
    const id = parseCashuTokenId(cashuTokenIdText);
    if (id) return { kind: "cashuToken", id };
  }

  if (path === "nostr-relays") return { kind: "nostrRelays" };
  if (path === "nostr-relay/new") return { kind: "nostrRelayNew" };

  const relayPrefix = "nostr-relay/";
  const relayId = decodePrefixedSegment(path, relayPrefix);
  if (relayId) return { kind: "nostrRelay", id: relayId };

  if (path === "advanced/chat-storage") return { kind: "chatStorage" };
  if (path === "evolu-servers") return { kind: "evoluServers" };
  if (path === "evolu-data") return { kind: "evoluData" };
  if (path === "evolu-current-data") return { kind: "evoluCurrentData" };
  if (path === "evolu-history-data") return { kind: "evoluHistoryData" };

  if (path === "evolu-server/new") return { kind: "evoluServerNew" };

  const evoluServerPrefix = "evolu-server/";
  const evoluServerId = decodePrefixedSegment(path, evoluServerPrefix);
  if (evoluServerId) return { kind: "evoluServer", id: evoluServerId };

  const chatPrefix = "chat/";
  if (path.startsWith(chatPrefix)) {
    const rest = path.slice(chatPrefix.length);
    const [rawId, rawSub, rawOfferId] = rest.split("/");
    const id = decodeSegment(rawId ?? "");
    const sub = (rawSub ?? "").trim();
    const offerId = decodeSegment(rawOfferId ?? "");
    if (id && sub === "bank-payment-offer" && offerId) {
      if (id.toLowerCase().startsWith(UNKNOWN_CONTACT_ID_PREFIX)) {
        return { kind: "chat", id };
      }
      return { kind: "bankPaymentOffer", chatId: id, offerId };
    }
    if (id) return { kind: "chat", id };
  }

  if (path === "contact/new") return { kind: "contactNew" };

  const contactPrefix = "contact/";
  if (path.startsWith(contactPrefix)) {
    const rest = path.slice(contactPrefix.length);
    const [rawId, rawSub] = rest.split("/");
    const idText = decodeSegment(rawId ?? "");
    const sub = (rawSub ?? "").trim();

    if (idText) {
      const id = parseContactId(idText);
      if (!id) return { kind: "wallet" };
      if (sub === "edit") return { kind: "contactEdit", id };
      if (sub === "pay") return { kind: "contactPay", id };
      return { kind: "contact", id };
    }
  }

  return { kind: "wallet" };
};

/** The query parameters a route reads; any other parameter in a legacy hash is a command. */
const ROUTE_QUERY_PARAMS: Partial<Record<Route["kind"], readonly string[]>> = {
  recurringPaymentNew: ["contact", "amount"],
};

/**
 * The route path for a hash URL from before path routing (`#contacts` →
 * `contacts`), or null for anything that is not a known route: command links
 * such as `#add/…`, `#nostrconnect…`, `#linkauth…` or a `?cashu=` query stay
 * fragments for their own handlers, so no fragment secret reaches a path.
 * A bank payment carries its SPAYD (account, amount, message) in the route,
 * so it is null too.
 */
export const routePathFromLegacyHash = (hash: string): string | null => {
  const value = hash.replace(/^#/, "");
  const queryStart = value.indexOf("?");
  const path = queryStart < 0 ? value : value.slice(0, queryStart);
  const route = parseRoutePath(path);
  if (route.kind === "wallet" && path !== "wallet") return null;
  if (path.startsWith("add/") || route.kind === "bankPayment") return null;

  const params = new URLSearchParams(
    queryStart < 0 ? "" : value.slice(queryStart + 1),
  );
  const routeParams = ROUTE_QUERY_PARAMS[route.kind] ?? [];
  if ([...params.keys()].some((key) => !routeParams.includes(key))) {
    return null;
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
};

export type NavigationAction =
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
  | { route: "settingsNostrIdentity" }
  | { route: "keryxCompanies" }
  | { route: "keryxCompanyNew" }
  | { route: "keryxCompany"; id: KeryxSubscriptionId }
  | { route: "keryxAnnouncement"; id: KeryxSubscriptionId; key: string }
  | { route: "proxyPayments" }
  | { route: "settingsUnits" }
  | { route: "settingsTutorial" }
  | { route: "settingsBlocked" }
  | { route: "settingsReceiveMethod" }
  | { route: "transactions" }
  | {
      route: "recurringPaymentNew";
      prefill?: { amountSat?: number; contactId?: string };
    }
  | { route: "recurringPayment"; id: string }
  | { route: "recurringPaymentEdit"; id: string }
  | { route: "topup" }
  | { route: "topupNoAmount" }
  | { route: "topupInvoice" }
  | { route: "wallet" };

const recurringPaymentNewQuery = (
  prefill: { amountSat?: number; contactId?: string } | undefined,
): string => {
  const query = new URLSearchParams();
  if (prefill?.contactId) query.set("contact", prefill.contactId);
  if (prefill?.amountSat) query.set("amount", String(prefill.amountSat));
  return query.size > 0 ? `?${query.toString()}` : "";
};

/** The route path `parseRoutePath` reads back as the action's route. */
export const routePathFor = (action: NavigationAction): string => {
  switch (action.route) {
    case "contacts":
      return "contacts";
    case "settings":
      return "settings";
    case "settingsLanguage":
      return "settings/language";
    case "settingsAppearance":
      return "settings/appearance";
    case "settingsUnits":
      return "settings/units";
    case "settingsTutorial":
      return "settings/tutorial";
    case "settingsBlocked":
      return "settings/blocked";
    case "settingsReceiveMethod":
      return "settings/receive-method";
    case "settingsMasterKeys":
      return "settings/master-keys";
    case "settingsNostrIdentity":
      return "settings/nostr-identity";
    case "keryxCompanies":
      return "settings/keryx";
    case "keryxCompanyNew":
      return "settings/keryx/new";
    case "keryxCompany":
      return `settings/keryx/${encodeURIComponent(action.id)}`;
    case "keryxAnnouncement":
      return `settings/keryx/${encodeURIComponent(action.id)}/${encodeURIComponent(action.key)}`;
    case "proxyPayments":
      return "proxy";
    case "advanced":
      return "advanced";
    case "advancedAutoPayLimit":
      return "advanced/auto-pay-limit";
    case "advancedInspector":
      return "advanced/inspector";
    case "advancedInspectorTimeline":
      return "advanced/inspector/timeline";
    case "advancedPushDebug":
      return "advanced/push-debug";
    case "mints":
      return "advanced/mints";
    case "mintNew":
      return "advanced/mints/new";
    case "mint":
      return `advanced/mint/${encodeURIComponent(action.mintUrl.trim())}`;
    case "contact":
      return `contact/${encodeURIComponent(action.id)}`;
    case "contactEdit":
      return `contact/${encodeURIComponent(action.id)}/edit`;
    case "contactPay":
      return `contact/${encodeURIComponent(action.id)}/pay`;
    case "chat":
      return `chat/${encodeURIComponent(action.id)}`;
    case "contactNew":
      return "contact/new";
    case "wallet":
      return "wallet";
    case "transactions":
      return "wallet/transactions";
    case "recurringPaymentNew":
      return `wallet/recurring/new${recurringPaymentNewQuery(action.prefill)}`;
    case "recurringPayment":
      return `wallet/recurring/${encodeURIComponent(action.id)}`;
    case "recurringPaymentEdit":
      return `wallet/recurring/${encodeURIComponent(action.id)}/edit`;
    case "topup":
      return "wallet/topup";
    case "topupNoAmount":
      return "wallet/topup/no-amount";
    case "topupInvoice":
      return "wallet/topup/invoice";
    case "cashuProofs":
      return "wallet/tokens/proofs";
    case "cashuTokens":
      return "wallet/tokens";
    case "lnAddressPay":
      return `payln/${encodeURIComponent(action.lnAddress)}`;
    case "manualPay":
      return "wallet/pay";
    case "bankPayment":
      return `wallet/bank-payment/${encodeURIComponent(action.spdPayload.trim())}${action.editing ? BANK_PAYMENT_EDIT_SUFFIX : ""}`;
    case "bankPaymentNew":
      return "wallet/bank-payment/new";
    case "bankPaymentOffer":
      return `chat/${encodeURIComponent(action.chatId.trim())}/bank-payment-offer/${encodeURIComponent(action.offerId.trim())}`;
    case "cashuTokenNew":
      return "wallet/token/new";
    case "cashuTokenEmit":
      return "wallet/token/emit";
    case "cashuToken":
      return `wallet/token/${encodeURIComponent(action.id)}`;
    case "profile":
      return "profile";
    case "profileEdit":
      return "profile/edit";
    case "nostrRelays":
      return "nostr-relays";
    case "nostrRelay":
      return `nostr-relay/${encodeURIComponent(action.id)}`;
    case "nostrRelayNew":
      return "nostr-relay/new";
    case "chatStorage":
      return "advanced/chat-storage";
    case "evoluServers":
      return "evolu-servers";
    case "evoluData":
      return "evolu-data";
    case "evoluCurrentData":
      return "evolu-current-data";
    case "evoluHistoryData":
      return "evolu-history-data";
    case "evoluServer":
      return `evolu-server/${encodeURIComponent(action.id)}`;
    case "evoluServerNew":
      return "evolu-server/new";
  }
};
