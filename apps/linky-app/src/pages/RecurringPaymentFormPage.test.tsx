import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { epochToDateTimeLocal } from "../app/lib/recurringPaymentDisplay";
import { contactIdFor } from "../testUtils/recurringOrders";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { FEEDBACK_CONTACT_NPUB } from "../utils/constants";
import { nowSeconds } from "../utils/time";
import { RecurringPaymentFormPage } from "./RecurringPaymentFormPage";

const CONTACT_ID = contactIdFor("alice");
const LINKY_ID = contactIdFor("linky");

const { contactRows, saveNpubContact } = vi.hoisted(() => ({
  contactRows: new Array<{ id: string; name: string; npub: string }>(),
  saveNpubContact: vi.fn(),
}));

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock(),
);

vi.mock("../app/hooks/payments/useRecurringPaymentsActions", () => ({
  useRecurringMintUrl: () => "https://mint.example",
  useRecurringPaymentsActions: () => ({
    createRecurringPayment: vi.fn(async () => true),
    updateRecurringPayment: vi.fn(async () => true),
  }),
}));

vi.mock("../app/hooks/useLinksync", () => ({
  useContactRows: () => [
    { id: CONTACT_ID, name: "Alice", npub: "npub1alice" },
    ...contactRows,
  ],
  useRecurringPaymentRecords: () => [],
}));

vi.mock("../app/hooks/contacts/useSaveNpubContact", () => ({
  useSaveNpubContact: () => saveNpubContact,
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
    contactRows.length = 0;
    saveNpubContact.mockReset();
  });

  it("offers the Linky team first, ahead of the sorted contacts", async () => {
    contactRows.push({
      id: LINKY_ID,
      name: "Linky",
      npub: FEEDBACK_CONTACT_NPUB,
    });
    const container = await renderForm("#wallet/recurring/new");
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(
        "[data-testid=recurring-picker-linky], [data-testid=recurring-picker-contact]",
      ),
    );
    expect(rows.map((row) => row.dataset.testid)).toEqual([
      "recurring-picker-linky",
      "recurring-picker-contact",
    ]);
    const linkyRow = rows[0];
    if (!linkyRow) throw new Error("Linky row missing");
    expect(linkyRow.textContent).toContain("supportLinkyPickerHint");

    await click(linkyRow);
    expect(saveNpubContact).not.toHaveBeenCalled();
    expect(
      container.querySelector("[data-testid=recurring-recipient-name]")
        ?.textContent,
    ).toBe("Linky");
  });

  it("saves the Linky team as a contact when it is picked for the first time", async () => {
    saveNpubContact.mockReturnValue({
      contact: { id: LINKY_ID, npub: FEEDBACK_CONTACT_NPUB },
      created: true,
      npub: FEEDBACK_CONTACT_NPUB,
    });
    const container = await renderForm("#wallet/recurring/new");
    const linkyRow = container.querySelector<HTMLElement>(
      "[data-testid=recurring-picker-linky]",
    );
    if (!linkyRow) throw new Error("Linky row missing");
    expect(linkyRow.textContent).toContain("appTitle");

    await click(linkyRow);
    expect(saveNpubContact).toHaveBeenCalledWith(FEEDBACK_CONTACT_NPUB);
    expect(container.querySelector("[role=status]")).not.toBeNull();
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
