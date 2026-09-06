import * as Evolu from "@evolu/common";
import { describe, expect, it } from "vitest";
import { TransactionId } from "../../evoluIds";
import type { TransactionRow } from "../../evolu";
import { buildTransactionHistory } from "./transactionHistory";

const ownerId = Evolu.OwnerId.orThrow("AAAAAAAAAAAAAAAAAAAAAA");
const makeRow = (overrides: Partial<TransactionRow> = {}): TransactionRow => ({
  id: TransactionId.orThrow("AAAAAAAAAAAAAAAAAAAAAA"),
  ownerId,
  createdAt: Evolu.DateIso.orThrow("2026-01-01T00:00:00.000Z"),
  updatedAt: Evolu.DateIso.orThrow("2026-01-01T00:00:00.000Z"),
  isDeleted: null,
  createdAtSec: Evolu.PositiveInt.orThrow(1_700_000_000),
  direction: Evolu.NonEmptyString100.orThrow("out"),
  status: Evolu.NonEmptyString100.orThrow("ok"),
  amount: null,
  fee: null,
  category: null,
  method: null,
  phase: null,
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
    const { transactions } = buildTransactionHistory([makeRow()], ownerId, []);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ amount: null, fee: null });
  });

  it("skips incomplete synced rows and rows from another owner's lane", () => {
    const { transactions } = buildTransactionHistory(
      [
        makeRow({ createdAtSec: null }),
        makeRow({ direction: null }),
        makeRow({ status: Evolu.NonEmptyString100.orThrow("unsupported") }),
        makeRow({ ownerId: Evolu.OwnerId.orThrow("AQEBAQEBAQEBAQEBAQEBAQ") }),
      ],
      ownerId,
      [],
    );
    expect(transactions).toEqual([]);
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
    const { transactions } = buildTransactionHistory(
      [issued, spent],
      ownerId,
      [],
    );
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      id: spent.id,
      amount: 42,
      details: { invoice: "stored invoice", usedTokenIds: ["token-id"] },
    });
  });
});
