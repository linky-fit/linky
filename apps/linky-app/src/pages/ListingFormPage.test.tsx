import { Effect } from "effect";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { ListingFormPage } from "./ListingFormPage";

const { insert, navigateTo } = vi.hoisted(() => ({
  insert: vi.fn(() => Effect.void),
  navigateTo: vi.fn(),
}));

vi.mock("../hooks/useRouting", () => ({ navigateTo }));

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock({
    displayCurrency: "czk",
    lang: "cs",
  }),
);

vi.mock("../app/hooks/useLinksync", () => ({
  useListingRecords: () => [],
  useListingsRepository: () => ({ insert }),
}));

// The enabled display currencies, in Settings: sats off, bitcoin and koruna on.
vi.mock("@linky-fit/linkstr-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linky-fit/linkstr-react")>()),
  useAtomValue: () => ["btc", "czk"],
}));

const input = (container: HTMLElement, testId: string): HTMLInputElement => {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  if (!(element instanceof HTMLInputElement)) throw new Error(testId);
  return element;
};

const button = (container: HTMLElement, testId: string): HTMLButtonElement => {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  if (!(element instanceof HTMLButtonElement)) throw new Error(testId);
  return element;
};

const type = async (element: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const alerts = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[role="alert"]')).map(
    (element) => element.textContent,
  );

describe("ListingFormPage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    insert.mockClear();
    navigateTo.mockClear();
  });

  it("marks the empty fields when Add is pressed and saves once they are filled", async () => {
    const { container } = await renderIntoDocument(<ListingFormPage />);

    expect(alerts(container)).toEqual([]);
    await act(async () => {
      button(container, "listing-save").click();
    });
    expect(alerts(container)).toEqual([
      "listingTitleMissing",
      "listingPriceMissing",
      "listingUnitMissing",
    ]);
    expect(insert).not.toHaveBeenCalled();

    await type(input(container, "listing-title"), "Domácí vajíčka");
    await type(input(container, "listing-amount"), "90");
    expect(alerts(container)).toEqual(["listingUnitMissing"]);
    await type(input(container, "listing-unit"), "za 10 ks");
    expect(alerts(container)).toEqual([]);

    await act(async () => {
      button(container, "listing-save").click();
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: "90",
        currency: "CZK",
        unit: "za 10 ks",
      }),
    );
    expect(navigateTo).toHaveBeenCalledWith({ route: "listings" });
  });

  it("keeps the price numeric and prices bitcoin in sats when only bitcoin is enabled", async () => {
    const { container } = await renderIntoDocument(<ListingFormPage />);
    const amount = input(container, "listing-amount");
    const currency = button(container, "listing-currency");
    expect(currency.textContent).toBe("Kč");

    await type(amount, "1 200,505 Kč");
    expect(amount.value).toBe("1200,50");

    // Sats are off in Settings, so the other unit is bitcoin, not sat.
    await act(async () => {
      currency.click();
    });
    expect(currency.textContent).toBe("₿");
    expect(amount.value).toBe("1200,50");
    await act(async () => {
      currency.click();
    });
    expect(currency.textContent).toBe("Kč");

    await act(async () => {
      currency.click();
    });
    await type(amount, "0.0005");
    await type(input(container, "listing-title"), "Hlídání dětí");
    await type(input(container, "listing-unit"), "za hodinu");
    await act(async () => {
      button(container, "listing-save").click();
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "50000", currency: "SAT" }),
    );
  });
});
