import {
  NonEmptyString100,
  NonEmptyString1000,
  PositiveInt,
} from "@evolu/common";
import { createId } from "@linky-fit/domain";
import { NewOperation, ProofId } from "@linky-fit/linkshu";
import { Schema } from "effect";
import { linkyStore, runNow } from "../testing/linky";
import {
  deriveTransactionCategory,
  makeTransactionsRepository,
  transactionIdForOperation,
  transactionIdForQuote,
  transactionIdForRestore,
} from "./transactions";
import { makeWalletRepository } from "./wallet";

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

  it("rotates the scope once the writes cross its rule", () => {
    const { store } = linkyStore();
    const transactions = makeTransactionsRepository(store);
    const row = () => ({
      id: createId<"Transaction">(),
      createdAtSec: PositiveInt.orThrow(1),
      direction: text("in"),
      status: text("ok"),
      note: NonEmptyString1000.orThrow("x".repeat(1000)),
    });
    for (let i = 0; i < 300; i += 1) runNow(transactions.insert(row()));
    expect(runNow(store.activeIndex("transactions"))).toBe(1);
    expect(runNow(transactions.all)).toHaveLength(300);
  });

  it("resolves a melt's operation and its quote to one row id", () => {
    const { store } = linkyStore();
    const melt = runNow(
      makeWalletRepository(store).operations.insert(
        Schema.decodeUnknownSync(NewOperation)({
          kind: "melt",
          status: "pending",
          mint: "https://mint.example",
          unit: "sat",
          keysetId: null,
          amount: 8,
          feeReserve: 1,
          inputsTotal: 9,
          quoteId: "quote-1",
          invoice: null,
          sourceMint: null,
          counter: null,
          locked: null,
          expiresAt: null,
          createdAt: 1_700_000_000,
          tokenText: null,
          error: null,
        }),
      ),
    );
    expect(melt.quoteId).not.toBeNull();
    if (melt.quoteId === null) return;
    expect(transactionIdForQuote("melt", melt.mint, melt.quoteId)).toBe(
      transactionIdForOperation(melt.id),
    );
  });

  it("gives a restore of the same proofs one row id in any order", () => {
    const a = ProofId.make("a");
    const b = ProofId.make("b");
    expect(transactionIdForRestore([a, b])).toBe(
      transactionIdForRestore([b, a]),
    );
  });
});
