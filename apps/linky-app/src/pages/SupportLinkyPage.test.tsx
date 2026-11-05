import { RegistryContext } from "@linky-fit/linkstr-react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { payAmountAtom } from "../app/state/wallet/contactPay";
import { makeTestAppRegistry } from "../testUtils/appRegistry";
import { contactIdFor } from "../testUtils/recurringOrders";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import {
  CONTACTS_ONBOARDING_HAS_SUPPORTED_STORAGE_KEY,
  FEEDBACK_CONTACT_NPUB,
} from "../utils/constants";
import { SupportLinkyPage } from "./SupportLinkyPage";

const LINKY_ID = contactIdFor("linky");

const { createRecurringPayment, navigateTo, pushToast } = vi.hoisted(() => ({
  createRecurringPayment: vi.fn(async () => true),
  navigateTo: vi.fn(),
  pushToast: vi.fn(),
}));

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock({ pushToast }),
);
vi.mock("../app/hooks/shell/navIntents", () => ({
  useSetNavIntent: () => vi.fn(),
}));
vi.mock("../app/hooks/payments/useRecurringPaymentsActions", () => ({
  useRecurringPaymentsActions: () => ({ createRecurringPayment }),
}));
vi.mock("../app/hooks/useFeedbackContact", () => ({
  useLinkyContact: () => ({
    contact: {
      deleted: false,
      id: LINKY_ID,
      lnAddress: null,
      name: "Linky",
      npub: FEEDBACK_CONTACT_NPUB,
    },
    ensure: () => LINKY_ID,
    saved: true,
  }),
}));
vi.mock("../app/hooks/contacts/useDisplayContacts", () => ({
  useContacts: () => [{ id: LINKY_ID, npub: FEEDBACK_CONTACT_NPUB }],
}));
vi.mock("../hooks/useRouting", () => ({ navigateTo }));

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

const renderPage = async () => {
  const registry = makeTestAppRegistry();
  const { container } = await renderIntoDocument(
    <RegistryContext.Provider value={registry}>
      <SupportLinkyPage />
    </RegistryContext.Provider>,
  );
  return { container, registry };
};

describe("SupportLinkyPage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("suggests a monthly contribution of 10 000 sat", async () => {
    const { container } = await renderPage();
    expect(
      container
        .querySelector("[data-testid=amount-display]")
        ?.textContent?.replace(/\s/g, ""),
    ).toBe("10000sat");
    expect(
      container
        .querySelector("[role=radio][aria-checked=true]")
        ?.textContent?.trim(),
    ).toBe("recurringPresetMonthly");
    expect(button(container, "supportSubmitRecurring").disabled).toBe(false);
  });

  it("creates the recurring payment to the Linky team and remembers the support", async () => {
    const { container } = await renderPage();
    await click(button(container, "supportSubmitRecurring"));
    expect(createRecurringPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: { amount: 10_000, unit: "sat" },
        contactId: LINKY_ID,
        interval: { unit: "month", count: 1 },
        note: null,
      }),
    );
    expect(navigateTo).toHaveBeenCalledWith({ route: "wallet" });
    expect(pushToast).toHaveBeenCalledWith("supportThanks");
    expect(
      localStorage.getItem(CONTACTS_ONBOARDING_HAS_SUPPORTED_STORAGE_KEY),
    ).toBe("1");
  });

  it("opens the pay screen with the amount for a one-time contribution", async () => {
    const { container, registry } = await renderPage();
    await click(button(container, "supportOnce"));
    await click(button(container, "supportSubmitOnce"));
    expect(createRecurringPayment).not.toHaveBeenCalled();
    expect(registry.get(payAmountAtom)).toBe("10000");
    expect(navigateTo).toHaveBeenCalledWith({
      route: "contactPay",
      id: LINKY_ID,
    });
  });
});
