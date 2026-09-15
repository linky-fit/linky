import { NonEmptyString100, PositiveInt } from "@evolu/common";
import { createId } from "../model/ids";
import { linkyStore, runNow } from "../testing/linky";
import {
  deriveTransactionCategory,
  makeTransactionsRepository,
} from "./transactions";

const text = (value: string) => NonEmptyString100.orThrow(value);

describe("transactions repository", () => {
  it("derives the category from the method", () => {
    expect(deriveTransactionCategory("cashu_chat")).toBe("contacts");
    expect(deriveTransactionCategory("lightning_address")).toBe("lightning");
    expect(deriveTransactionCategory("lightning_invoice")).toBe("lightning");
    expect(deriveTransactionCategory("cashu_token")).toBe("cashu");
    expect(deriveTransactionCategory(null)).toBe("cashu");
  });

  it("returns normalized records and skips rows with invalid direction or status", () => {
    const { store } = linkyStore();
    const transactions = makeTransactionsRepository(store);
    runNow(
      transactions.insert({
        id: createId<"Transaction">(),
        createdAtSec: PositiveInt.orThrow(10),
        direction: text("out"),
        status: text("ok"),
        method: text("cashu_chat"),
      }),
    );
    runNow(
      transactions.insert({
        id: createId<"Transaction">(),
        createdAtSec: PositiveInt.orThrow(11),
        direction: text("sideways"),
        status: text("ok"),
      }),
    );
    expect(runNow(transactions.all)).toMatchObject([
      { direction: "out", status: "ok", category: "contacts" },
    ]);
  });
});
