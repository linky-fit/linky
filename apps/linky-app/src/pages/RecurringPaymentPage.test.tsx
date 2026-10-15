import {
  makeRecurringPaymentsRepository,
  NonEmptyString100,
  NonEmptyString1000,
  normalizeRecurringPayment,
  PositiveInt,
  type RecurringPaymentRecord,
  type RecurringPaymentsRepository,
} from "@linky-fit/linksync";
import { recurringProgressColumn } from "@linky-fit/recurring-payment";
import { Effect } from "effect";
import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contactsAtom } from "../app/state/contacts/readModel";
import { defaultMintAtom } from "../app/state/wallet/defaultMint";
import { payWithCashuEnabledAtom } from "../app/state/wallet/prefs";
import { navigateTo } from "../hooks/useRouting";
import { makeTestLinkyStore } from "../testUtils/linkyStore";
import {
  contactIdFor,
  DUE,
  recurringPaymentIdFor,
} from "../testUtils/recurringOrders";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { RecurringPaymentPage } from "./RecurringPaymentPage";

const ORDER_ID = recurringPaymentIdFor("rp-1");
const { records, repositoryRef } = vi.hoisted(() => {
  const repositoryRef: { current: RecurringPaymentsRepository | null } = {
    current: null,
  };
  return {
    records: { current: new Array<RecurringPaymentRecord>() },
    repositoryRef,
  };
});

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock(),
);

vi.mock("../app/hooks/useLinksync", () => ({
  useContactRows: () => [],
  useRecurringPaymentRecords: () => records.current,
  useRecurringPaymentsRepository: () => repositoryRef.current,
}));

vi.mock("../hooks/useRouting", () => ({ navigateTo: vi.fn() }));

const insertOrder = (repository: RecurringPaymentsRepository) => {
  Effect.runSync(
    repository.insert({
      id: ORDER_ID,
      createdAtSec: PositiveInt.orThrow(DUE - 60),
      contactId: contactIdFor("alice"),
      mintUrl: NonEmptyString1000.orThrow("https://mint.example"),
      rail: NonEmptyString100.orThrow("cashu"),
      amount: PositiveInt.orThrow(10),
      unit: NonEmptyString100.orThrow("sat"),
      intervalUnit: NonEmptyString100.orThrow("day"),
      intervalCount: PositiveInt.orThrow(1),
      anchorAtSec: PositiveInt.orThrow(DUE),
      timeZone: NonEmptyString100.orThrow("UTC"),
      progress: NonEmptyString1000.orThrow(
        recurringProgressColumn({ runCount: 0, nextDueAtSec: DUE }),
      ),
    }),
  );
  const row = Effect.runSync(repository.byId(ORDER_ID));
  const record: RecurringPaymentRecord | null =
    row === null ? null : normalizeRecurringPayment(row);
  if (record === null) throw new Error("unreadable row");
  records.current = [record];
};

const registry = () =>
  AtomRegistry.make({
    initialValues: [
      [contactsAtom, []],
      [defaultMintAtom, "https://mint.example"],
      [payWithCashuEnabledAtom, true],
    ],
  });

const button = (container: HTMLElement, ...labels: string[]) => {
  const found = Array.from(container.querySelectorAll("button")).find(
    (candidate) => labels.includes(candidate.textContent),
  );
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`button missing: ${labels.join(", ")}`);
  }
  return found;
};

const deleteButton = (container: HTMLElement) =>
  button(container, "delete", "deleteArmedHint");

const renderPage = async () => {
  const repository = makeRecurringPaymentsRepository(
    makeTestLinkyStore().store,
  );
  insertOrder(repository);
  repositoryRef.current = repository;
  const { container } = await renderIntoDocument(
    <RegistryContext.Provider value={registry()}>
      <RecurringPaymentPage id={ORDER_ID} />
    </RegistryContext.Provider>,
  );
  return { container, repository };
};

const click = async (element: HTMLElement): Promise<void> => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("RecurringPaymentPage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("deletes only on the second tap and returns to the history", async () => {
    const { container, repository } = await renderPage();

    await click(deleteButton(container));
    expect(deleteButton(container).textContent).toBe("deleteArmedHint");
    expect(Effect.runSync(repository.all)).toHaveLength(1);
    expect(navigateTo).not.toHaveBeenCalled();

    await click(deleteButton(container));
    await vi.waitFor(() =>
      expect(navigateTo).toHaveBeenCalledWith({ route: "transactions" }),
    );
    expect(Effect.runSync(repository.all)).toHaveLength(0);
  });

  it("pauses the payment", async () => {
    const { container, repository } = await renderPage();

    await click(button(container, "recurringPause"));

    await vi.waitFor(() =>
      expect(Effect.runSync(repository.byId(ORDER_ID))?.pausedAtSec).not.toBe(
        null,
      ),
    );
  });
});
