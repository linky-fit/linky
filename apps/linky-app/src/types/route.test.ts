import {
  CashuOperationId,
  ContactId,
  keryxSubscriptionIdFor,
  RecurringPaymentId,
} from "@linky-fit/linksync";
import { describe, expect, it } from "vitest";
import {
  parseRoutePath,
  routePathFor,
  routePathFromLegacyHash,
  type NavigationAction,
} from "./route";
import { parseNativeDeepLinkUrl } from "../utils/deepLinks";

describe("parseRoutePath", () => {
  it("parses the bank payment route with an optional edit suffix", () => {
    const payload = "SPD*1.0*ACC:CZ6508000000192000145399*AM:1.00*CC:CZK";
    expect(
      parseRoutePath(`wallet/bank-payment/${encodeURIComponent(payload)}`),
    ).toEqual({
      kind: "bankPayment",
      spdPayload: payload,
    });

    expect(
      parseRoutePath(`wallet/bank-payment/${encodeURIComponent(payload)}/edit`),
    ).toEqual({
      kind: "bankPayment",
      spdPayload: payload,
      editing: true,
    });
  });

  it("parses the Keryx companies, company, announcement and add company routes", () => {
    const id = keryxSubscriptionIdFor("https://acme.example");
    expect(parseRoutePath("settings/keryx")).toEqual({
      kind: "keryxCompanies",
    });

    expect(parseRoutePath("settings/keryx/new")).toEqual({
      kind: "keryxCompanyNew",
    });

    expect(parseRoutePath(`settings/keryx/${id}`)).toEqual({
      kind: "keryxCompany",
      id,
    });

    expect(
      parseRoutePath(
        `settings/keryx/${id}/${encodeURIComponent("news/launch")}`,
      ),
    ).toEqual({
      kind: "keryxAnnouncement",
      id,
      key: "news/launch",
    });

    expect(parseRoutePath("settings/keryx/not-an-id")).toEqual({
      kind: "wallet",
    });
  });

  it("defaults to wallet for an empty path", () => {
    expect(parseRoutePath("")).toEqual({ kind: "wallet" });
  });

  it("supports the explicit contacts route", () => {
    expect(parseRoutePath("contacts")).toEqual({ kind: "contacts" });
  });

  it("parses settings and its language, appearance and units subpages", () => {
    expect(parseRoutePath("settings")).toEqual({ kind: "settings" });

    expect(parseRoutePath("settings/language")).toEqual({
      kind: "settingsLanguage",
    });

    expect(parseRoutePath("settings/appearance")).toEqual({
      kind: "settingsAppearance",
    });

    expect(parseRoutePath("settings/units")).toEqual({ kind: "settingsUnits" });

    expect(parseRoutePath("settings/tutorial")).toEqual({
      kind: "settingsTutorial",
    });

    expect(parseRoutePath("settings/blocked")).toEqual({
      kind: "settingsBlocked",
    });

    expect(parseRoutePath("settings/receive-method")).toEqual({
      kind: "settingsReceiveMethod",
    });

    expect(parseRoutePath("settings/master-keys")).toEqual({
      kind: "settingsMasterKeys",
    });

    expect(parseRoutePath("settings/nostr-identity")).toEqual({
      kind: "settingsNostrIdentity",
    });

    expect(parseRoutePath("proxy")).toEqual({ kind: "proxyPayments" });

    expect(parseRoutePath("settings/proxy-payments")).toEqual({
      kind: "proxyPayments",
    });
  });

  it("parses the manual bank payment entry before the payload routes", () => {
    expect(parseRoutePath("wallet/bank-payment/new")).toEqual({
      kind: "bankPaymentNew",
    });

    expect(parseRoutePath("wallet/bank-payment/SPD*1.0*ACC:CZ65")).toEqual({
      kind: "bankPayment",
      spdPayload: "SPD*1.0*ACC:CZ65",
    });
  });

  it("parses the in-app inspector route", () => {
    expect(parseRoutePath("advanced/inspector")).toEqual({
      kind: "advancedInspector",
    });
  });

  it("parses the in-app inspector timeline route", () => {
    expect(parseRoutePath("advanced/inspector/timeline")).toEqual({
      kind: "advancedInspectorTimeline",
    });
  });

  it("falls back to wallet for unknown paths", () => {
    expect(parseRoutePath("unknown-route")).toEqual({ kind: "wallet" });
  });

  it("parses the main tokens route", () => {
    expect(parseRoutePath("wallet/tokens")).toEqual({ kind: "cashuTokens" });
  });

  it("parses the token emit route", () => {
    expect(parseRoutePath("wallet/token/emit")).toEqual({
      kind: "cashuTokenEmit",
    });
  });

  it("parses the token import route", () => {
    expect(parseRoutePath("wallet/token/new")).toEqual({
      kind: "cashuTokenNew",
    });
  });

  it("keeps a proxy-payment offer from an unknown sender in message requests", () => {
    const unknownChatId = `unknown:${"a".repeat(64)}`;
    expect(
      parseRoutePath(
        `chat/${encodeURIComponent(unknownChatId)}/bank-payment-offer/offer-1`,
      ),
    ).toEqual({
      kind: "chat",
      id: unknownChatId,
    });
  });
  it("parses the manual payment route", () => {
    expect(parseRoutePath("wallet/pay")).toEqual({ kind: "manualPay" });
  });
});

const contactId = ContactId.orThrow("AgICAgICAgICAgICAgICAg");
const keryxId = keryxSubscriptionIdFor("https://acme.example");

const sampleActions: {
  [Name in NavigationAction["route"]]: Extract<
    NavigationAction,
    { route: Name }
  >;
} = {
  advanced: { route: "advanced" },
  advancedAutoPayLimit: { route: "advancedAutoPayLimit" },
  advancedInspector: { route: "advancedInspector" },
  advancedInspectorTimeline: { route: "advancedInspectorTimeline" },
  advancedPushDebug: { route: "advancedPushDebug" },
  cashuTokenEmit: { route: "cashuTokenEmit" },
  cashuToken: {
    route: "cashuToken",
    id: CashuOperationId.orThrow("AQEBAQEBAQEBAQEBAQEBAQ"),
  },
  cashuTokenNew: { route: "cashuTokenNew" },
  cashuTokens: { route: "cashuTokens" },
  cashuProofs: { route: "cashuProofs" },
  chat: { route: "chat", id: contactId },
  contact: { route: "contact", id: contactId },
  contactEdit: { route: "contactEdit", id: contactId },
  contactNew: { route: "contactNew" },
  contactPay: { route: "contactPay", id: contactId },
  contacts: { route: "contacts" },
  evoluCurrentData: { route: "evoluCurrentData" },
  evoluData: { route: "evoluData" },
  evoluHistoryData: { route: "evoluHistoryData" },
  evoluServer: { route: "evoluServer", id: "wss://evolu.example/a?b=c" },
  evoluServerNew: { route: "evoluServerNew" },
  chatStorage: { route: "chatStorage" },
  evoluServers: { route: "evoluServers" },
  lnAddressPay: { route: "lnAddressPay", lnAddress: "bob@pay.test" },
  manualPay: { route: "manualPay" },
  bankPayment: {
    route: "bankPayment",
    spdPayload: "SPD*1.0*ACC:CZ65/0800*AM:1.00",
    editing: true,
  },
  bankPaymentNew: { route: "bankPaymentNew" },
  bankPaymentOffer: {
    route: "bankPaymentOffer",
    chatId: contactId,
    offerId: "offer/1",
  },
  mint: { route: "mint", mintUrl: "https://mint.example/path" },
  mints: { route: "mints" },
  mintNew: { route: "mintNew" },
  nostrRelay: { route: "nostrRelay", id: "wss://relay.example/" },
  nostrRelayNew: { route: "nostrRelayNew" },
  nostrRelays: { route: "nostrRelays" },
  profile: { route: "profile" },
  profileEdit: { route: "profileEdit" },
  settings: { route: "settings" },
  settingsLanguage: { route: "settingsLanguage" },
  settingsAppearance: { route: "settingsAppearance" },
  settingsMasterKeys: { route: "settingsMasterKeys" },
  settingsNostrIdentity: { route: "settingsNostrIdentity" },
  keryxCompanies: { route: "keryxCompanies" },
  keryxCompanyNew: { route: "keryxCompanyNew" },
  keryxCompany: { route: "keryxCompany", id: keryxId },
  keryxAnnouncement: {
    route: "keryxAnnouncement",
    id: keryxId,
    key: "news/launch?x",
  },
  proxyPayments: { route: "proxyPayments" },
  settingsUnits: { route: "settingsUnits" },
  settingsTutorial: { route: "settingsTutorial" },
  settingsBlocked: { route: "settingsBlocked" },
  settingsReceiveMethod: { route: "settingsReceiveMethod" },
  transactions: { route: "transactions" },
  recurringPaymentNew: { route: "recurringPaymentNew" },
  recurringPayment: {
    route: "recurringPayment",
    id: RecurringPaymentId.orThrow("AwMDAwMDAwMDAwMDAwMDAw"),
  },
  recurringPaymentEdit: {
    route: "recurringPaymentEdit",
    id: RecurringPaymentId.orThrow("AwMDAwMDAwMDAwMDAwMDAw"),
  },
  topup: { route: "topup" },
  topupNoAmount: { route: "topupNoAmount" },
  topupInvoice: { route: "topupInvoice" },
  wallet: { route: "wallet" },
};

describe("routePathFor", () => {
  it.each(Object.values(sampleActions))(
    "$route reads back through parseRoutePath",
    (action) => {
      const { route, ...fields } = action;
      expect(parseRoutePath(routePathFor(action))).toEqual({
        kind: route,
        ...fields,
      });
    },
  );

  it("carries the recurring payment prefill in the query", () => {
    const path = routePathFor({
      route: "recurringPaymentNew",
      prefill: { contactId: "contact-1", amountSat: 10 },
    });

    expect(path).toBe("wallet/recurring/new?contact=contact-1&amount=10");
    expect(parseRoutePath(path)).toEqual({ kind: "recurringPaymentNew" });
  });
});

describe("routePathFromLegacyHash", () => {
  it.each([
    ["#contacts", "contacts"],
    ["#wallet", "wallet"],
    ["#wallet/transactions", "wallet/transactions"],
    ["#proxy", "proxy"],
    [`#chat/${contactId}`, `chat/${contactId}`],
    [`#contact/${contactId}/pay`, `contact/${contactId}/pay`],
    [
      "#wallet/recurring/new?contact=c1&amount=10",
      "wallet/recurring/new?contact=c1&amount=10",
    ],
  ])("redirects %s to %s", (hash, path) => {
    expect(routePathFromLegacyHash(hash)).toBe(path);
  });

  it.each([
    ["an add-contact link", "#add/npub1abc"],
    ["a nostrconnect link", `#nostrconnect://${"b".repeat(64)}?secret=s3cr3t`],
    ["an encoded nostrconnect link", "#nostrconnect%3A%2F%2Fabc%3Fsecret%3Ds"],
    ["a linkauth link", "#linkauth?nonce=n&cb=https%3A%2F%2Fsite.example"],
    ["a cashu protocol link", "#wallet?cashu=cashuAeyJ0b2tlbiI6W119"],
    ["a notification open", "#contacts?notificationOpen=%7B%7D"],
    [
      "a route with a param it does not read",
      "#wallet/recurring/new?contact=c1&cashu=cashuA",
    ],
    ["an unknown route", "#unknown"],
    [
      "a bank payment, whose path holds the SPAYD",
      `#wallet/bank-payment/${encodeURIComponent("SPD*1.0*ACC:CZ6508000000192000145399*AM:1.00")}`,
    ],
    ["a route with an invalid id", "#contact/not-an-id"],
    ["an empty hash", ""],
  ])("leaves %s to its own handler", (_name, hash) => {
    expect(routePathFromLegacyHash(hash)).toBeNull();
  });
});

describe("parseNativeDeepLinkUrl", () => {
  it("parses a bare nostr host npub", () => {
    expect(
      parseNativeDeepLinkUrl(
        "nostr://npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8",
      ),
    ).toEqual({
      kind: "scan-text",
      rawUrl:
        "nostr://npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8",
      text: "nostr:npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8",
    });
  });

  it("parses a nostr contact path variant", () => {
    expect(
      parseNativeDeepLinkUrl(
        "nostr://contact/nostr:npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8",
      ),
    ).toEqual({
      kind: "scan-text",
      rawUrl:
        "nostr://contact/nostr:npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8",
      text: "nostr:npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8",
    });
  });

  it("parses a nostr npub query parameter", () => {
    expect(
      parseNativeDeepLinkUrl(
        "nostr://open-contact?npub=npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8",
      ),
    ).toEqual({
      kind: "scan-text",
      rawUrl:
        "nostr://open-contact?npub=npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8",
      text: "nostr:npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8",
    });
  });

  it("parses a cashu token host", () => {
    expect(
      parseNativeDeepLinkUrl(
        "cashu://cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vbWludC5leGFtcGxlIiwicHJvb2ZzIjpbeyJhbW91bnQiOjEsInNlY3JldCI6InMiLCJDIjoiYyJ9XX1dfQ",
      ),
    ).toEqual({
      kind: "scan-text",
      rawUrl:
        "cashu://cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vbWludC5leGFtcGxlIiwicHJvb2ZzIjpbeyJhbW91bnQiOjEsInNlY3JldCI6InMiLCJDIjoiYyJ9XX1dfQ",
      text: "cashu:cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vbWludC5leGFtcGxlIiwicHJvb2ZzIjpbeyJhbW91bnQiOjEsInNlY3JldCI6InMiLCJDIjoiYyJ9XX1dfQ",
    });
  });

  it("parses a cashu query parameter", () => {
    expect(
      parseNativeDeepLinkUrl(
        "cashu://receive?token=cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vbWludC5leGFtcGxlIiwicHJvb2ZzIjpbeyJhbW91bnQiOjEsInNlY3JldCI6InMiLCJDIjoiYyJ9XX1dfQ",
      ),
    ).toEqual({
      kind: "scan-text",
      rawUrl:
        "cashu://receive?token=cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vbWludC5leGFtcGxlIiwicHJvb2ZzIjpbeyJhbW91bnQiOjEsInNlY3JldCI6InMiLCJDIjoiYyJ9XX1dfQ",
      text: "cashu:cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vbWludC5leGFtcGxlIiwicHJvb2ZzIjpbeyJhbW91bnQiOjEsInNlY3JldCI6InMiLCJDIjoiYyJ9XX1dfQ",
    });
  });

  it("forwards a nostrconnect URI untouched, query included", () => {
    const uri = `nostrconnect://${"b".repeat(64)}?relay=wss%3A%2F%2Frelay.example.com&secret=s3cr3t&perms=sign_event%3A22242&name=Example&url=https%3A%2F%2Fexample.com`;

    expect(parseNativeDeepLinkUrl(`  ${uri}\n`)).toEqual({
      kind: "scan-text",
      rawUrl: uri,
      text: uri,
    });
  });

  it("accepts the nostrconnect: form without slashes", () => {
    const uri = `NostrConnect:${"b".repeat(64)}?relay=wss%3A%2F%2Frelay.example.com`;

    expect(parseNativeDeepLinkUrl(uri)?.text).toBe(uri);
  });

  it("rejects unsupported or malformed deep links", () => {
    expect(parseNativeDeepLinkUrl("https://example.com")).toBeNull();
    expect(parseNativeDeepLinkUrl("nostr://wallet")).toBeNull();
    expect(parseNativeDeepLinkUrl("cashu://wallet")).toBeNull();
  });
});
