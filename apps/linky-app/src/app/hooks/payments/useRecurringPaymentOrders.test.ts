import { expect, it } from "vitest";
import {
  isPayableContact,
  recurringContactSummaries,
} from "./useRecurringPaymentOrders";

it("keeps a deleted contact's name for its payments but never offers it as a payee", () => {
  const summaries = recurringContactSummaries([
    { id: "kept", name: "Alice", npub: "npub1alice" },
    { id: "deleted", name: "Bob", npub: "npub1bob", archivedAtSec: 1 },
    { id: "unreachable", name: "Carol" },
  ]);

  expect(summaries.get("deleted")?.name).toBe("Bob");
  expect(
    [...summaries.values()].filter(isPayableContact).map(({ id }) => id),
  ).toEqual(["kept"]);
});
