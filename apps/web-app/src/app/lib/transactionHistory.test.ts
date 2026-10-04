import { OperationId, StoredOperation } from "@linky-fit/linkshu";
import {
  NonEmptyString,
  NonEmptyString1000,
  OwnerId,
  PositiveInt,
  transactionIdForOperation,
} from "@linky-fit/linksync";
import type { TransactionRecord } from "@linky-fit/linksync";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { TransactionId } from "../../evoluIds";
import {
  buildTransactionHistory,
  readRepeatablePayment,
  type TransactionItem,
} from "./transactionHistory";

const ownerId = OwnerId.orThrow("AAAAAAAAAAAAAAAAAAAAAA");
const makeRow = (
  overrides: Partial<TransactionRecord> = {},
): TransactionRecord => ({
  id: TransactionId.orThrow("AAAAAAAAAAAAAAAAAAAAAA"),
  ownerId,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  isDeleted: null,
  createdAtSec: PositiveInt.orThrow(1_700_000_000),
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

const operation = (
  overrides: Partial<Schema.Schema.Encoded<typeof StoredOperation>> = {},
): StoredOperation =>
  Schema.decodeUnknownSync(StoredOperation)({
    id: "op-1",
    kind: "melt",
    status: "pending",
    mint: "https://mint.example",
    unit: "sat",
    keysetId: null,
    amount: 42,
    feeReserve: null,
    inputsTotal: null,
    quoteId: "quote-1",
    invoice: null,
    sourceMint: null,
    counter: null,
    locked: null,
    expiresAt: null,
    createdAt: 1_700_000_000,
    tokenText: null,
    error: null,
    ...overrides,
  });

const details = (value: object) =>
  NonEmptyString.orThrow(JSON.stringify(value));

describe("buildTransactionHistory", () => {
  it("preserves absent amounts and fees instead of displaying zero", () => {
    const { transactions } = buildTransactionHistory([makeRow()], []);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ amount: null, fee: null });
  });

  it("keeps the repository's category and drops nothing else", () => {
    const { transactions } = buildTransactionHistory(
      [makeRow({ category: "lightning" })],
      [],
    );
    expect(transactions[0]).toMatchObject({ category: "lightning" });
  });

  it("merges emitted token details into its eventual spend", () => {
    const issued = makeRow({
      detailsJson: NonEmptyString.orThrow(
        JSON.stringify({
          issuedTokenId: "token-id",
          invoice: "stored invoice",
        }),
      ),
    });
    const spent = makeRow({
      id: TransactionId.orThrow("AQEBAQEBAQEBAQEBAQEBAQ"),
      createdAtSec: PositiveInt.orThrow(1_700_000_001),
      amount: PositiveInt.orThrow(42),
      detailsJson: NonEmptyString.orThrow(
        JSON.stringify({ usedTokenIds: ["token-id"] }),
      ),
    });
    const { transactions } = buildTransactionHistory([issued, spent], []);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      id: spent.id,
      amount: 42,
      details: { invoice: "stored invoice", usedTokenIds: ["token-id"] },
    });
  });

  it("settles a pending row by its operation", () => {
    const melt = operation({ status: "paid" });
    const { transactions } = buildTransactionHistory(
      [makeRow({ id: transactionIdForOperation(melt.id), status: "pending" })],
      [melt],
    );
    expect(transactions[0]).toMatchObject({ status: "ok", hiddenReason: null });
  });

  it("settles a legacy pending melt row by mint and quote", () => {
    const { transactions } = buildTransactionHistory(
      [
        makeRow({
          status: "pending",
          mint: NonEmptyString1000.orThrow("https://mint.example"),
          detailsJson: details({ meltQuoteId: "quote-1" }),
        }),
      ],
      [operation({ status: "unpaid" })],
    );
    expect(transactions[0]).toMatchObject({
      status: "error",
      hiddenReason: "failed",
    });
  });

  it("never downgrades a row a receipt confirmed", () => {
    const receive = operation({
      kind: "receive",
      status: "failed",
      quoteId: null,
      tokenText: "cashuBtoken",
    });
    const { transactions } = buildTransactionHistory(
      [makeRow({ id: transactionIdForOperation(receive.id), direction: "in" })],
      [receive],
    );
    expect(transactions[0]).toMatchObject({ status: "ok", hiddenReason: null });
  });

  it("hides failures but keeps a returned send visible", () => {
    const send = operation({
      id: OperationId.make("op-send"),
      kind: "send",
      status: "returned",
      quoteId: null,
      tokenText: "cashuBsent",
    });
    const { transactions } = buildTransactionHistory(
      [
        makeRow({ status: "error" }),
        makeRow({
          id: transactionIdForOperation(send.id),
          createdAtSec: PositiveInt.orThrow(1_700_000_001),
        }),
      ],
      [send],
    );
    expect(
      transactions.map((item) => [item.hiddenReason, item.isReturned]),
    ).toEqual([
      [null, true],
      ["failed", false],
    ]);
  });

  it("leaves a pending token send pending although its operation is done", () => {
    const send = operation({
      kind: "send",
      status: "done",
      quoteId: null,
      tokenText: "cashuBsent",
    });
    const { transactions } = buildTransactionHistory(
      [makeRow({ id: transactionIdForOperation(send.id), status: "pending" })],
      [send],
    );
    expect(transactions[0]).toMatchObject({ status: "pending" });
  });

  it("links a legacy invoice row only to the operation of its direction", () => {
    const invoice = "lnbc1shared";
    const lightningDetails = details({ lightningInvoice: invoice });
    const { transactions } = buildTransactionHistory(
      [
        makeRow({ direction: "out", detailsJson: lightningDetails }),
        makeRow({
          id: TransactionId.orThrow("AQEBAQEBAQEBAQEBAQEBAQ"),
          direction: "in",
          detailsJson: lightningDetails,
        }),
      ],
      [
        operation({ status: "paid", invoice }),
        operation({
          id: OperationId.make("op-topup"),
          kind: "topup",
          status: "done",
          quoteId: "quote-2",
          invoice,
        }),
      ],
    );
    expect(transactions.map((item) => item.hiddenReason)).toEqual([null, null]);
  });

  it("treats rows of one receipt as duplicates whatever their ids", () => {
    const gained = details({ gainedTokenIds: ["token-1"] });
    const receive = operation({
      kind: "receive",
      status: "done",
      quoteId: null,
      tokenText: "cashuBinput",
    });
    const { transactions } = buildTransactionHistory(
      [
        makeRow({ direction: "in", detailsJson: gained }),
        makeRow({
          id: transactionIdForOperation(receive.id),
          direction: "in",
          detailsJson: gained,
          createdAtSec: PositiveInt.orThrow(1_700_000_001),
        }),
      ],
      [receive],
    );
    expect(transactions.map((item) => item.hiddenReason)).toEqual([
      "duplicate",
      null,
    ]);
  });

  it("keeps the best of rows that record one event and hides the rest", () => {
    const quote = details({ meltQuoteId: "quote-1" });
    const mint = NonEmptyString1000.orThrow("https://mint.example");
    const first = makeRow({
      id: TransactionId.orThrow("AQEBAQEBAQEBAQEBAQEBAQ"),
      mint,
      detailsJson: quote,
    });
    const later = makeRow({
      id: TransactionId.orThrow("AgICAgICAgICAgICAgICAg"),
      mint,
      detailsJson: quote,
      createdAtSec: PositiveInt.orThrow(1_700_000_005),
    });
    const { transactions } = buildTransactionHistory(
      [later, first],
      [operation({ status: "paid" })],
    );
    expect(transactions.map((item) => [item.id, item.hiddenReason])).toEqual([
      [later.id, "duplicate"],
      [first.id, null],
    ]);
  });
});

describe("readRepeatablePayment", () => {
  const contactId = "contact-1";
  const contacts = new Map([
    [contactId, { lnAddress: null, npub: "npub1alice" }],
  ]);
  const item = (overrides: Partial<TransactionItem> = {}): TransactionItem => ({
    amount: 10,
    category: "cashu",
    contactId,
    createdAtSec: 1_700_000_000,
    details: null,
    direction: "out",
    error: null,
    fee: null,
    hiddenReason: null,
    id: "tx-1",
    isReturned: false,
    method: "cashu_chat",
    mint: null,
    note: null,
    pendingLabel: null,
    status: "ok",
    unit: "sat",
    ...overrides,
  });

  it("offers a completed sat payment to a saved contact for repeating", () => {
    expect(readRepeatablePayment(item(), contacts)).toEqual({
      amountSat: 10,
      contactId,
    });
  });

  it.each<[string, Partial<TransactionItem>]>([
    ["an incoming payment", { direction: "in" }],
    ["a failed payment", { status: "error" }],
    ["a fiat amount", { unit: "czk" }],
    ["an invoice payment", { method: "lightning_invoice" }],
    ["an unknown contact", { contactId: "contact-2" }],
  ])("offers nothing for %s", (_name, overrides) => {
    expect(readRepeatablePayment(item(overrides), contacts)).toBeNull();
  });
});
