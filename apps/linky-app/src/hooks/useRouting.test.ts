// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { navigateTo, returnFromBankPaymentOffer } from "./useRouting";

afterEach(() => {
  window.location.hash = "";
  window.sessionStorage.clear();
});

describe("navigateTo", () => {
  it("opens a new recurring payment prefilled with a contact and amount", () => {
    navigateTo({
      route: "recurringPaymentNew",
      prefill: { contactId: "contact-1", amountSat: 10 },
    });
    expect(window.location.hash).toBe(
      "#wallet/recurring/new?contact=contact-1&amount=10",
    );
  });
});

describe("returnFromBankPaymentOffer", () => {
  it("returns to the chat the offer was opened from", () => {
    window.location.hash = "#chat/abc";
    navigateTo({ route: "bankPaymentOffer", chatId: "abc", offerId: "o1" });
    expect(window.location.hash).toBe("#chat/abc/bank-payment-offer/o1");

    returnFromBankPaymentOffer("fallback");

    expect(window.location.hash).toBe("#chat/abc");
  });

  it("reads a return hash stored before route paths", () => {
    window.sessionStorage.setItem(
      "linky.bank_payment_offer_return_hash.v1",
      "#contacts",
    );

    returnFromBankPaymentOffer("fallback");

    expect(window.location.hash).toBe("#contacts");
  });

  it("falls back to the offer's chat without a stored route", () => {
    returnFromBankPaymentOffer("fallback");

    expect(window.location.hash).toBe("#chat/fallback");
  });
});
