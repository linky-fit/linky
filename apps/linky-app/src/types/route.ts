import { Listing, parsePubkey, type Pubkey } from "@linky-fit/linkstr";
import {
  CashuOperationId,
  ContactId,
  KeryxSubscriptionId,
  ListingId,
  MessageId,
  OnchainTransferId,
  RecurringPaymentId,
} from "@linky-fit/linksync";
import { Schema } from "effect";
import { UNKNOWN_CONTACT_ID_PREFIX } from "../utils/constants";

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

const parseCashuTokenId = (value: string): CashuOperationId | null => {
  const result = CashuOperationId.fromUnknown(value);
  return result.ok ? result.value : null;
};

const parseContactId = (value: string): ContactId | null => {
  const result = ContactId.fromUnknown(value);
  return result.ok ? result.value : null;
};

const LISTINGS_PREFIX = "#collaboration/listings/";
const isListingWireId = Schema.is(Listing.fields.id);

/** `<npub>/<listing id>`, or `<npub>/<listing id>/m/<message id>` for the copy a message holds. */
const parseListingDetail = (path: string): Route | null => {
  const [rawAuthor, rawListingId, rawSub, rawMessageId, ...rest] =
    path.split("/");
  const author = parsePubkey(decodeSegment(rawAuthor ?? "") ?? "");
  const listingId = decodeSegment(rawListingId ?? "");
  if (!author || !listingId || !isListingWireId(listingId) || rest.length > 0)
    return null;
  if (rawSub === undefined) {
    return { kind: "listing", author, listingId, messageId: null };
  }
  const messageId = MessageId.fromUnknown(decodeSegment(rawMessageId ?? ""));
  return rawSub === "m" && messageId.ok
    ? { kind: "listing", author, listingId, messageId: messageId.value }
    : null;
};

export type Route =
  | { kind: "contacts" }
  | { kind: "settings" }
  | { kind: "settingsLanguage" }
  | { kind: "settingsAppearance" }
  | { kind: "settingsUnits" }
  | { kind: "settingsTutorial" }
  | { kind: "settingsSupport" }
  | { kind: "settingsWhatsNew" }
  | { kind: "settingsBlocked" }
  | { kind: "settingsReceiveMethod" }
  | { kind: "settingsMasterKeys" }
  | { kind: "settingsNostrIdentity" }
  | { kind: "keryxCompanies" }
  | { kind: "keryxCompanyNew" }
  | { kind: "keryxCompany"; id: KeryxSubscriptionId }
  | { kind: "keryxAnnouncement"; id: KeryxSubscriptionId; key: string }
  | { kind: "collaboration" }
  | { kind: "proxyPayments" }
  | { kind: "cash" }
  | { kind: "listings" }
  | { kind: "listingNew" }
  | { kind: "listingEdit"; id: ListingId }
  /** Opened from a message: the copy that message holds, otherwise the author's live listing. */
  | {
      kind: "listing";
      author: Pubkey;
      listingId: string;
      messageId: MessageId | null;
    }
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
  | { kind: "walletHistory" }
  | { kind: "transaction"; id: string }
  | { kind: "recurringPaymentNew" }
  | { kind: "recurringPayment"; id: RecurringPaymentId }
  | { kind: "recurringPaymentEdit"; id: RecurringPaymentId }
  | { kind: "topup" }
  /** A scanned bitcoin address or BIP21 URI fills the payout address and picks the amount. */
  | { kind: "onchainSend"; payoutAddress: string; amount: number | null }
  | { kind: "onchainReceive" }
  | { kind: "onchainTransfer"; id: OnchainTransferId }
  | { kind: "topupNoAmount" }
  | { kind: "topupInvoice" }
  | { kind: "manualPay" }
  | { kind: "bankPayment"; spdPayload: string; editing?: true }
  | { kind: "bankPaymentNew" }
  | { kind: "lnAddressPay"; lnAddress: string }
  /** A Lightning invoice that names no amount; the page asks for one. */
  | { kind: "lnInvoicePay"; invoice: string }
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

export const parseRouteFromHash = (): Route => {
  const rawHash = globalThis.location?.hash ?? "";
  const hasExplicitEmptyHash = (globalThis.location?.href ?? "").endsWith("#");
  const hash = rawHash.split("?")[0] ?? rawHash;
  if (hash === "" && hasExplicitEmptyHash) return { kind: "contacts" };
  if (hash === "") return { kind: "wallet" };
  if (hash === "#") return { kind: "contacts" };
  if (hash === "#contacts") return { kind: "contacts" };
  // The shared-profile link is taken out of the hash once the app starts.
  if (hash.startsWith("#add/")) return { kind: "contacts" };
  if (hash === "#settings") return { kind: "settings" };
  if (hash === "#settings/language") return { kind: "settingsLanguage" };
  if (hash === "#settings/appearance") return { kind: "settingsAppearance" };
  if (hash === "#settings/units") return { kind: "settingsUnits" };
  if (hash === "#settings/tutorial") return { kind: "settingsTutorial" };
  if (hash === "#settings/support") return { kind: "settingsSupport" };
  if (hash === "#settings/whats-new") return { kind: "settingsWhatsNew" };
  if (hash === "#settings/blocked") return { kind: "settingsBlocked" };
  if (hash === "#settings/receive-method") {
    return { kind: "settingsReceiveMethod" };
  }
  if (hash === "#settings/master-keys") return { kind: "settingsMasterKeys" };
  if (hash === "#settings/nostr-identity") {
    return { kind: "settingsNostrIdentity" };
  }
  if (hash === "#settings/keryx") return { kind: "keryxCompanies" };
  if (hash === "#settings/keryx/new") return { kind: "keryxCompanyNew" };
  const keryxPrefix = "#settings/keryx/";
  if (hash.startsWith(keryxPrefix)) {
    const [rawId, rawKey] = hash.slice(keryxPrefix.length).split("/");
    const id = KeryxSubscriptionId.fromUnknown(decodeSegment(rawId ?? ""));
    const key = decodeSegment(rawKey ?? "");
    if (id.ok) {
      return key
        ? { kind: "keryxAnnouncement", id: id.value, key }
        : { kind: "keryxCompany", id: id.value };
    }
  }
  // The old settings hash stays parseable for links already shared.
  if (hash === "#proxy" || hash === "#settings/proxy-payments") {
    return { kind: "proxyPayments" };
  }
  if (hash === "#collaboration") return { kind: "collaboration" };
  if (hash === "#collaboration/cash") return { kind: "cash" };
  if (hash === "#collaboration/listings") return { kind: "listings" };
  if (hash === "#collaboration/listings/new") return { kind: "listingNew" };
  const listingDetail = hash.startsWith(LISTINGS_PREFIX)
    ? parseListingDetail(hash.slice(LISTINGS_PREFIX.length))
    : null;
  if (listingDetail) return listingDetail;
  const listingId = ListingId.fromUnknown(
    decodeHashSegment(hash, LISTINGS_PREFIX),
  );
  if (listingId.ok) return { kind: "listingEdit", id: listingId.value };
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
  if (hash === "#advanced/mints/new") return { kind: "mintNew" };

  const mintPrefix = "#advanced/mint/";
  const mintUrl = decodeHashSegment(hash, mintPrefix);
  if (mintUrl) return { kind: "mint", mintUrl };
  if (hash === "#profile/claim-lightning") {
    return { kind: "profileEdit" };
  }
  if (hash === "#profile/edit") return { kind: "profileEdit" };
  if (hash === "#profile") return { kind: "profile" };
  if (hash === "#wallet") return { kind: "wallet" };
  if (hash === "#wallet/history") return { kind: "walletHistory" };
  const transactionId = decodeHashSegment(hash, "#wallet/transactions/");
  if (transactionId) return { kind: "transaction", id: transactionId };
  if (hash === "#wallet/recurring/new") return { kind: "recurringPaymentNew" };
  const recurringPrefix = "#wallet/recurring/";
  if (hash.startsWith(recurringPrefix)) {
    const [rawId, rawSub] = hash.slice(recurringPrefix.length).split("/");
    const id = RecurringPaymentId.fromUnknown(decodeSegment(rawId ?? ""));
    if (id.ok) {
      return (rawSub ?? "") === "edit"
        ? { kind: "recurringPaymentEdit", id: id.value }
        : { kind: "recurringPayment", id: id.value };
    }
  }
  if (hash === "#wallet/topup") return { kind: "topup" };
  if (hash === "#wallet/topup/no-amount") return { kind: "topupNoAmount" };
  if (hash === "#wallet/topup/invoice") return { kind: "topupInvoice" };
  if (hash === "#wallet/onchain/send" || hash === "#wallet/onchain/receive") {
    const query = new URLSearchParams(rawHash.split("?")[1] ?? "");
    const amountQuery = Number(query.get("amount") ?? "");
    const amount =
      Number.isSafeInteger(amountQuery) && amountQuery > 0 ? amountQuery : null;
    return hash === "#wallet/onchain/send"
      ? {
          kind: "onchainSend",
          payoutAddress: query.get("address")?.trim() ?? "",
          amount,
        }
      : { kind: "onchainReceive" };
  }
  const transferId = OnchainTransferId.fromUnknown(
    decodeHashSegment(hash, "#wallet/onchain/"),
  );
  if (transferId.ok) return { kind: "onchainTransfer", id: transferId.value };
  if (hash === "#wallet/pay") return { kind: "manualPay" };
  if (hash === "#wallet/bank-payment/new") return { kind: "bankPaymentNew" };

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

  if (hash === "#wallet/tokens/proofs") return { kind: "cashuProofs" };
  if (hash === "#wallet/tokens") return { kind: "cashuTokens" };

  const invoice = decodeHashSegment(hash, "#payinvoice/");
  if (invoice) return { kind: "lnInvoicePay", invoice };
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

  if (hash === "#advanced/chat-storage") return { kind: "chatStorage" };
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
