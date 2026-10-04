import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { epochToDateTimeLocal } from "../app/lib/recurringPaymentDisplay";
import { contactIdFor } from "../testUtils/recurringOrders";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { applyAmountInputKeyWithDraft } from "../utils/displayAmounts";
import { nowSeconds } from "../utils/time";
import { RecurringPaymentFormPage } from "./RecurringPaymentFormPage";

const CONTACT_ID = contactIdFor("alice");

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({
    allowedDisplayCurrencies: ["sat"],
    applyAmountInputKeyWithDraft: (
      amount: string,
      displayValue: string | null,
      key: string,
    ) =>
      applyAmountInputKeyWithDraft(
        amount,
        displayValue,
        key,
        { displayCurrency: "sat", fiatRates: null },
        false,
      ),
    cashuIsBusy: false,
    decimalAmountInputKeyVisible: false,
    displayCurrency: "sat",
    displayUnit: "sat",
    fiatRates: null,
    formatDisplayedAmountParts: (amountSat: number) => ({
      amountText: String(amountSat),
      approxPrefix: "",
      unitLabel: "sat",
    }),
    lang: "en",
    nostrPictureByNpub: {},
    t: (key: string) => key,
  }),
  useAppShellActions: () => ({ cycleDisplayCurrency: vi.fn() }),
}));

vi.mock("../app/context/RecurringPaymentsContext", () => ({
  useRecurringPaymentsContext: () => ({
    createRecurringPayment: vi.fn(async () => true),
    defaultMintUrl: "https://mint.example",
    updateRecurringPayment: vi.fn(async () => true),
  }),
}));

vi.mock("../app/hooks/useLinksync", () => ({
  useContactRows: () => [{ id: CONTACT_ID, name: "Alice", npub: "npub1alice" }],
  useRecurringPaymentRecords: () => [],
}));

vi.mock("../hooks/useRouting", () => ({ navigateTo: vi.fn() }));

const button = (container: HTMLElement, label: string): HTMLButtonElement => {
  const found = Array.from(container.querySelectorAll("button")).find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label ||
      candidate.textContent === label,
  );
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`button missing: ${label}`);
  }
  return found;
};

const click = async (element: HTMLElement): Promise<void> => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const setInputValue = async (
  input: HTMLInputElement,
  value: string,
): Promise<void> => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const renderForm = async (hash: string) => {
  window.location.hash = hash;
  const { container } = await renderIntoDocument(<RecurringPaymentFormPage />);
  return container;
};

describe("RecurringPaymentFormPage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    window.location.hash = "";
  });

  it("saves nothing without an amount or with a first payment in the past", async () => {
    const container = await renderForm(
      `#wallet/recurring/new?contact=${CONTACT_ID}`,
    );
    const submit = button(container, "recurringSave");
    expect(submit.disabled).toBe(true);

    await click(button(container, "1"));
    await click(button(container, "0"));
    expect(submit.disabled).toBe(false);

    const firstRun = container.querySelector<HTMLInputElement>(
      "input[aria-label=recurringFirstRunLabel]",
    );
    if (firstRun === null) throw new Error("first payment input missing");
    expect(firstRun.min).not.toBe("");
    await setInputValue(firstRun, epochToDateTimeLocal(nowSeconds() - 120));
    expect(container.textContent).toContain("recurringFirstRunInPast");
    expect(submit.disabled).toBe(true);
  });

  it("prefills the contact and amount of a payment being repeated", async () => {
    const container = await renderForm(
      `#wallet/recurring/new?contact=${CONTACT_ID}&amount=10`,
    );
    expect(
      container.querySelector("[data-testid=recurring-recipient-name]")
        ?.textContent,
    ).toBe("Alice");
    expect(button(container, "recurringChangeRecipient")).toBeTruthy();
    expect(
      container
        .querySelector("[data-testid=amount-display]")
        ?.textContent?.replace(/\s/g, ""),
    ).toBe("10sat");
    expect(button(container, "recurringSave").disabled).toBe(false);
  });
});
