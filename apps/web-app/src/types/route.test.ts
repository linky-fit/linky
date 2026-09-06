import { afterEach, describe, expect, it } from "vitest";
import { parseRouteFromHash } from "./route";
import { parseNativeDeepLinkUrl } from "../utils/deepLinks";

const replaceHash = (hash: string) => {
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}${hash}`,
  );
};

afterEach(() => {
  replaceHash("");
});

describe("parseRouteFromHash", () => {
  it("parses the bank payment route with an optional edit suffix", () => {
    const payload = "SPD*1.0*ACC:CZ6508000000192000145399*AM:1.00*CC:CZK";
    replaceHash(`#wallet/bank-payment/${encodeURIComponent(payload)}`);
    expect(parseRouteFromHash()).toEqual({
      kind: "bankPayment",
      spdPayload: payload,
    });

    replaceHash(`#wallet/bank-payment/${encodeURIComponent(payload)}/edit`);
    expect(parseRouteFromHash()).toEqual({
      kind: "bankPayment",
      spdPayload: payload,
      editing: true,
    });
  });

  it("defaults to wallet when the url has no hash", () => {
    replaceHash("");

    expect(parseRouteFromHash()).toEqual({ kind: "wallet" });
  });

  it("keeps explicit contacts hash on the contacts route", () => {
    replaceHash("#");

    expect(parseRouteFromHash()).toEqual({ kind: "contacts" });
  });

  it("supports the explicit contacts route hash", () => {
    replaceHash("#contacts");

    expect(parseRouteFromHash()).toEqual({ kind: "contacts" });
  });

  it("parses settings and its language and units subpages", () => {
    replaceHash("#settings");
    expect(parseRouteFromHash()).toEqual({ kind: "settings" });

    replaceHash("#settings/language");
    expect(parseRouteFromHash()).toEqual({ kind: "settingsLanguage" });

    replaceHash("#settings/units");
    expect(parseRouteFromHash()).toEqual({ kind: "settingsUnits" });

    replaceHash("#settings/master-keys");
    expect(parseRouteFromHash()).toEqual({ kind: "settingsMasterKeys" });
  });

  it("parses the in-app inspector route", () => {
    replaceHash("#advanced/inspector");

    expect(parseRouteFromHash()).toEqual({ kind: "advancedInspector" });
  });

  it("parses the in-app inspector timeline route", () => {
    replaceHash("#advanced/inspector/timeline");

    expect(parseRouteFromHash()).toEqual({ kind: "advancedInspectorTimeline" });
  });

  it("falls back to wallet for unknown hashes", () => {
    replaceHash("#unknown-route");

    expect(parseRouteFromHash()).toEqual({ kind: "wallet" });
  });

  it("parses the main tokens route", () => {
    replaceHash("#wallet/tokens");

    expect(parseRouteFromHash()).toEqual({ kind: "cashuTokens" });
  });

  it("parses the token emit route", () => {
    replaceHash("#wallet/token/emit");

    expect(parseRouteFromHash()).toEqual({ kind: "cashuTokenEmit" });
  });

  it("parses the token import route", () => {
    replaceHash("#wallet/token/new");

    expect(parseRouteFromHash()).toEqual({ kind: "cashuTokenNew" });
  });

  it("keeps a proxy-payment offer from an unknown sender in message requests", () => {
    const unknownChatId = `unknown:${"a".repeat(64)}`;
    replaceHash(
      `#chat/${encodeURIComponent(unknownChatId)}/bank-payment-offer/offer-1`,
    );

    expect(parseRouteFromHash()).toEqual({
      kind: "chat",
      id: unknownChatId,
    });
  });
  it("parses the manual payment route", () => {
    replaceHash("#wallet/pay");

    expect(parseRouteFromHash()).toEqual({ kind: "manualPay" });
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

  it("rejects unsupported or malformed deep links", () => {
    expect(parseNativeDeepLinkUrl("https://example.com")).toBeNull();
    expect(parseNativeDeepLinkUrl("nostr://wallet")).toBeNull();
    expect(parseNativeDeepLinkUrl("cashu://wallet")).toBeNull();
  });
});
