import { afterEach, describe, expect, it } from "vitest";
import { navigateTo } from "./useRouting";

describe("navigateTo", () => {
  afterEach(() => {
    window.location.hash = "";
  });

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
