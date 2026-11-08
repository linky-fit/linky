import {
  createId,
  createIdFromString,
  NonEmptyString100,
  NonEmptyString1000,
  OwnerId,
  PositiveInt,
  sqliteTrue,
  type ListingId,
  type ListingRecord,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { ListingFormPage } from "./ListingFormPage";

const { insert, navigateTo, records, update } = vi.hoisted(() => ({
  insert: vi.fn<(row: object) => Effect.Effect<void>>(() => Effect.void),
  navigateTo: vi.fn(),
  records: new Array<ListingRecord>(),
  update: vi.fn<(id: string, columns: object) => Effect.Effect<void>>(
    () => Effect.void,
  ),
}));

vi.mock("../hooks/useRouting", () => ({ navigateTo }));

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock({
    displayCurrency: "czk",
    lang: "cs",
  }),
);

vi.mock("../app/hooks/useLinksync", () => ({
  useListingRecords: () => records,
  useListingsRepository: () => ({ insert, update }),
}));

// The enabled display currencies, in Settings: sats off, bitcoin and koruna on.
vi.mock("@linky-fit/linkstr-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linky-fit/linkstr-react")>()),
  useAtomValue: () => ["btc", "czk"],
}));

type Field = HTMLInputElement | HTMLTextAreaElement;

const input = (container: HTMLElement, testId: string): Field => {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  if (
    !(element instanceof HTMLInputElement) &&
    !(element instanceof HTMLTextAreaElement)
  ) {
    throw new Error(testId);
  }
  return element;
};

const button = (container: HTMLElement, testId: string): HTMLButtonElement => {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  if (!(element instanceof HTMLButtonElement)) throw new Error(testId);
  return element;
};

const type = async (element: Field, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),
      "value",
    )?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const isDisabled = (element: HTMLButtonElement) =>
  element.getAttribute("aria-disabled") === "true";

// A disabled Button that explains itself takes the press on the layer over it.
const pressDisabled = async (element: HTMLButtonElement) => {
  const layer = element.nextElementSibling;
  if (!(layer instanceof HTMLElement)) throw new Error("no layer");
  await act(async () => {
    layer.click();
  });
};

const storedEggs = (id: ListingId): ListingRecord => ({
  id,
  createdAtSec: PositiveInt.orThrow(100),
  side: NonEmptyString100.orThrow("offer"),
  title: NonEmptyString1000.orThrow("Domácí vajíčka"),
  amount: NonEmptyString100.orThrow("90"),
  currency: NonEmptyString100.orThrow("CZK"),
  unit: NonEmptyString100.orThrow("za 10 ks"),
  priceByAgreement: null,
  description: NonEmptyString1000.orThrow("Z volného chovu."),
  image: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  isDeleted: 0,
  ownerId: OwnerId.orThrow(createId()),
});

const alerts = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[role="alert"]')).map(
    (element) => element.textContent,
  );

describe("ListingFormPage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    insert.mockClear();
    update.mockClear();
    navigateTo.mockClear();
    records.length = 0;
  });

  it("marks the empty fields when the disabled Add is pressed and saves once they are filled", async () => {
    const { container } = await renderIntoDocument(<ListingFormPage />);

    expect(isDisabled(button(container, "listing-save"))).toBe(true);
    expect(alerts(container)).toEqual([]);
    await pressDisabled(button(container, "listing-save"));
    expect(alerts(container)).toEqual([
      "listingTitleMissing",
      "listingUnitMissing",
    ]);
    expect(insert).not.toHaveBeenCalled();

    await type(input(container, "listing-title"), "Domácí vajíčka");
    await type(input(container, "listing-amount"), "90");
    expect(alerts(container)).toEqual(["listingUnitMissing"]);
    await type(input(container, "listing-unit"), "za 10 ks");
    await type(
      input(container, "listing-description"),
      "  Z volného chovu.\nVyzvednutí v Brně.\n",
    );
    expect(alerts(container)).toEqual([]);
    expect(isDisabled(button(container, "listing-save"))).toBe(false);

    await act(async () => {
      button(container, "listing-save").click();
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: "90",
        currency: "CZK",
        unit: "za 10 ks",
        description: "Z volného chovu.\nVyzvednutí v Brně.",
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
    expect(insert.mock.calls[0]?.[0]).not.toHaveProperty("description");
  });

  it("saves no price as one to be agreed and zero as free", async () => {
    const { container } = await renderIntoDocument(<ListingFormPage />);
    await type(input(container, "listing-title"), "Hlídání dětí");
    await type(input(container, "listing-unit"), "za hodinu");
    await act(async () => {
      button(container, "listing-save").click();
    });
    expect(insert).toHaveBeenLastCalledWith(
      expect.objectContaining({ amount: "0", priceByAgreement: 1 }),
    );

    await type(input(container, "listing-amount"), "0");
    await act(async () => {
      button(container, "listing-save").click();
    });
    expect(insert).toHaveBeenLastCalledWith(
      expect.objectContaining({ amount: "0" }),
    );
    expect(insert.mock.lastCall?.[0]).not.toHaveProperty("priceByAgreement");
  });

  it("opens a listing priced by agreement without a price and drops the flag once one is typed", async () => {
    const id = createIdFromString<"Listing">("babysitting");
    records.push({
      ...storedEggs(id),
      amount: NonEmptyString100.orThrow("0"),
      priceByAgreement: sqliteTrue,
    });
    const { container } = await renderIntoDocument(<ListingFormPage id={id} />);
    const amount = input(container, "listing-amount");
    expect(amount.value).toBe("");

    await type(amount, "250");
    await act(async () => {
      button(container, "listing-save").click();
    });
    expect(update).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ amount: "250", priceByAgreement: null }),
    );
  });

  it("loads a stored description into the edit and clears it", async () => {
    const id = createIdFromString<"Listing">("eggs");
    records.push(storedEggs(id));
    const { container } = await renderIntoDocument(<ListingFormPage id={id} />);
    const description = input(container, "listing-description");
    expect(description.value).toBe("Z volného chovu.");

    await type(description, " ");
    await act(async () => {
      button(container, "listing-save").click();
    });
    expect(update).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ description: null }),
    );
  });
});
