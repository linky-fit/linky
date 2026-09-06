import * as Evolu from "@evolu/common";
import { UNKNOWN_CONTACT_ID_PREFIX } from "../utils/constants";

const CashuTokenId = Evolu.id("CashuToken");
type CashuTokenId = typeof CashuTokenId.Type;
const ContactId = Evolu.id("Contact");
type ContactId = typeof ContactId.Type;

const decodeSegment = (value: string): string | null => {
  try {
    return decodeURIComponent(value).trim() || null;
  } catch {
    return null;
  }
};

export const BANK_PAYMENT_EDIT_SUFFIX = "/edit";

const decodeHashSegment = (hash: string, prefix: string): string | null =>
  hash.startsWith(prefix) ? decodeSegment(hash.slice(prefix.length)) : null;

const parseCashuTokenId = (value: string): CashuTokenId | null => {
  const result = CashuTokenId.fromUnknown(value);
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
  | { kind: "settingsUnits" }
  | { kind: "settingsMasterKeys" }
  | { kind: "advanced" }
  | { kind: "advancedAutoPayLimit" }
  | { kind: "advancedInspector" }
  | { kind: "advancedInspectorTimeline" }
  | { kind: "advancedPushDebug" }
  | { kind: "mints" }
  | { kind: "mint"; mintUrl: string }
  | { kind: "profile" }
  | { kind: "profileEdit" }
  | { kind: "wallet" }
  | { kind: "transactions" }
  | { kind: "topup" }
  | { kind: "topupNoAmount" }
  | { kind: "topupInvoice" }
  | { kind: "manualPay" }
  | { kind: "bankPayment"; spdPayload: string; editing?: true }
  | { kind: "lnAddressPay"; lnAddress: string }
  | { kind: "cashuTokens" }
  | { kind: "cashuTokenNew" }
  | { kind: "cashuTokenEmit" }
  | { kind: "cashuToken"; id: CashuTokenId }
  | { kind: "nostrRelays" }
  | { kind: "nostrRelay"; id: string }
  | { kind: "nostrRelayNew" }
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

export const parseRouteFromHash = (): Route => {
  const rawHash = globalThis.location?.hash ?? "";
  const hasExplicitEmptyHash = (globalThis.location?.href ?? "").endsWith("#");
  const hash = rawHash.split("?")[0] ?? rawHash;
  if (hash === "" && hasExplicitEmptyHash) return { kind: "contacts" };
  if (hash === "") return { kind: "wallet" };
  if (hash === "#") return { kind: "contacts" };
  if (hash === "#contacts") return { kind: "contacts" };
  if (hash === "#settings") return { kind: "settings" };
  if (hash === "#settings/language") return { kind: "settingsLanguage" };
  if (hash === "#settings/units") return { kind: "settingsUnits" };
  if (hash === "#settings/master-keys") return { kind: "settingsMasterKeys" };
  if (hash === "#advanced") return { kind: "advanced" };
  if (hash === "#advanced/auto-pay-limit") {
    return { kind: "advancedAutoPayLimit" };
  }
  if (hash === "#advanced/inspector") {
    return { kind: "advancedInspector" };
  }
  if (hash === "#advanced/inspector/timeline") {
    return { kind: "advancedInspectorTimeline" };
  }
  if (hash === "#advanced/push-debug") {
    return { kind: "advancedPushDebug" };
  }
  if (hash === "#advanced/mints") return { kind: "mints" };

  const mintPrefix = "#advanced/mint/";
  const mintUrl = decodeHashSegment(hash, mintPrefix);
  if (mintUrl) return { kind: "mint", mintUrl };
  if (hash === "#profile/claim-lightning") {
    return { kind: "profileEdit" };
  }
  if (hash === "#profile/edit") return { kind: "profileEdit" };
  if (hash === "#profile") return { kind: "profile" };
  if (hash === "#wallet") return { kind: "wallet" };
  if (hash === "#wallet/transactions") return { kind: "transactions" };
  if (hash === "#wallet/topup") return { kind: "topup" };
  if (hash === "#wallet/topup/no-amount") return { kind: "topupNoAmount" };
  if (hash === "#wallet/topup/invoice") return { kind: "topupInvoice" };
  if (hash === "#wallet/pay") return { kind: "manualPay" };

  const bankPaymentPrefix = "#wallet/bank-payment/";
  if (hash.startsWith(bankPaymentPrefix)) {
    const editing = hash.endsWith(BANK_PAYMENT_EDIT_SUFFIX);
    const spdPayload = decodeSegment(
      hash.slice(
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

  if (hash === "#wallet/tokens") return { kind: "cashuTokens" };

  const payLnPrefix = "#payln/";
  const lnAddress = decodeHashSegment(hash, payLnPrefix);
  if (lnAddress) return { kind: "lnAddressPay", lnAddress };
  if (hash === "#wallet/token/new") return { kind: "cashuTokenNew" };
  if (hash === "#wallet/token/emit") return { kind: "cashuTokenEmit" };

  const walletTokenPrefix = "#wallet/token/";
  const cashuTokenIdText = decodeHashSegment(hash, walletTokenPrefix);
  if (cashuTokenIdText) {
    const id = parseCashuTokenId(cashuTokenIdText);
    if (id) return { kind: "cashuToken", id };
  }

  if (hash === "#nostr-relays") return { kind: "nostrRelays" };
  if (hash === "#nostr-relay/new") return { kind: "nostrRelayNew" };

  const relayPrefix = "#nostr-relay/";
  const relayId = decodeHashSegment(hash, relayPrefix);
  if (relayId) return { kind: "nostrRelay", id: relayId };

  if (hash === "#evolu-servers") return { kind: "evoluServers" };
  if (hash === "#evolu-data") return { kind: "evoluData" };
  if (hash === "#evolu-current-data") return { kind: "evoluCurrentData" };
  if (hash === "#evolu-history-data") return { kind: "evoluHistoryData" };

  if (hash === "#evolu-server/new") return { kind: "evoluServerNew" };

  const evoluServerPrefix = "#evolu-server/";
  const evoluServerId = decodeHashSegment(hash, evoluServerPrefix);
  if (evoluServerId) return { kind: "evoluServer", id: evoluServerId };

  const chatPrefix = "#chat/";
  if (hash.startsWith(chatPrefix)) {
    const rest = hash.slice(chatPrefix.length);
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

  if (hash === "#contact/new") return { kind: "contactNew" };

  const contactPrefix = "#contact/";
  if (hash.startsWith(contactPrefix)) {
    const rest = hash.slice(contactPrefix.length);
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
