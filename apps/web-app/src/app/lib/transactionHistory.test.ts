import * as Evolu from "@evolu/common";
import type { TransactionRecord } from "@linky/linksync";
import { describe, expect, it } from "vitest";
import { TransactionId } from "../../evoluIds";
import { buildTransactionHistory } from "./transactionHistory";

const ownerId = Evolu.OwnerId.orThrow("AAAAAAAAAAAAAAAAAAAAAA");
const makeRow = (
  overrides: Partial<TransactionRecord> = {},
): TransactionRecord => ({
  id: TransactionId.orThrow("AAAAAAAAAAAAAAAAAAAAAA"),
  ownerId,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  isDeleted: null,
  createdAtSec: Evolu.PositiveInt.orThrow(1_700_000_000),
  direction: "out",
  status: "ok",
  category: "cashu",
  amount: null,
  fee: null,
  method: null,
  note: null,
  detailsJson: null,
  iconKind: null,
  contactId: null,
  mint: null,
  unit: null,
  error: null,
  pendingLabel: null,
  ...overrides,
});

describe("buildTransactionHistory", () => {
  it("preserves absent amounts and fees instead of displaying zero", () => {
    const { transactions } = buildTransactionHistory([makeRow()]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ amount: null, fee: null });
  });

  it("keeps the repository's category and drops nothing else", () => {
    const { transactions } = buildTransactionHistory([
      makeRow({ category: "lightning" }),
    ]);
    expect(transactions[0]).toMatchObject({ category: "lightning" });
  });

  it("merges emitted token details into its eventual spend", () => {
    const issued = makeRow({
      detailsJson: Evolu.NonEmptyString.orThrow(
        JSON.stringify({
          issuedTokenId: "token-id",
          invoice: "stored invoice",
        }),
      ),
    });
    const spent = makeRow({
      id: TransactionId.orThrow("AQEBAQEBAQEBAQEBAQEBAQ"),
      createdAtSec: Evolu.PositiveInt.orThrow(1_700_000_001),
      amount: Evolu.PositiveInt.orThrow(42),
      detailsJson: Evolu.NonEmptyString.orThrow(
        JSON.stringify({ usedTokenIds: ["token-id"] }),
      ),
    });
    const { transactions } = buildTransactionHistory([issued, spent]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      id: spent.id,
      amount: 42,
      details: { invoice: "stored invoice", usedTokenIds: ["token-id"] },
    });
  });
});
