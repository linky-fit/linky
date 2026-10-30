import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeLightningInvoice } from "../testUtils/lightningInvoice";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { LnInvoicePayPage } from "./LnInvoicePayPage";

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock(),
);
vi.mock("../app/hooks/wallet/useWalletInventory", () => ({
  useWalletBalance: () => ({
    canPayWithCashu: true,
    cashuBalance: 21_000,
    cashuBalanceAfterMelt: 21_000,
    cashuIsBusy: false,
  }),
}));
vi.mock("../components/LightningFeeHint", () => ({
  LightningFeeHint: () => null,
}));

const invoice = makeLightningInvoice("");

const button = (label: string) => {
  const found = [...document.querySelectorAll("button")].find(
    (element) =>
      element.textContent === label ||
      element.getAttribute("aria-label") === label,
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no ${label}`);
  return found;
};

const press = async (keys: string) => {
  for (const key of keys) {
    await act(async () => button(key).click());
  }
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("LnInvoicePayPage", () => {
  it("takes the amount on the keypad and pays the invoice with it at once", async () => {
    const pay = vi.fn(async () => true);
    const view = await renderIntoDocument(
      <LnInvoicePayPage invoice={invoice} payLightningInvoiceWithCashu={pay} />,
    );
    expect(document.body.textContent).toContain("Username purchase");
    expect(button("paySend").disabled).toBe(true);

    await press("30000");
    expect(button("paySend").disabled).toBe(true);
    expect(document.body.textContent).toContain("payInsufficient");

    await press("C");
    await press("2500");
    expect(button("paySend").disabled).toBe(false);
    await act(async () => button("paySend").click());
    expect(pay).toHaveBeenCalledExactlyOnceWith(invoice, 2500);
    await view.unmount();
  });
});
