import { OwnerId } from "@evolu/common";
import {
  Amount,
  MeltReceipt,
  MeltResumeResult,
  MintUrl,
  NonNegativeAmount,
  QuoteId,
  OperationId,
} from "@linky/linkshu";
import {
  NonEmptyString100,
  PositiveInt,
  TransactionId,
  type TransactionRecord,
} from "@linky/linksync";
import { Effect } from "effect";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { useMeltRecovery } from "./useMeltRecovery";

type Params = Parameters<typeof useMeltRecovery>[0];

const allMock = vi.fn<() => ReadonlyArray<TransactionRecord>>(() => []);
const updateMock = vi.fn<Params["transactions"]["update"]>(() => Effect.void);
const transactions: Params["transactions"] = {
  all: Effect.sync(() => allMock()),
  update: updateMock,
};

const result = (
  status: MeltResumeResult["status"],
  quoteId = "quote-1",
): MeltResumeResult =>
  new MeltResumeResult({
    quoteId: QuoteId.make(quoteId),
    mint: MintUrl.make("https://mint.example"),
    operationId: OperationId.make("op-1"),
    amount: Amount.make(40),
    status,
    receipt:
      status === "paid"
        ? new MeltReceipt({
            mint: MintUrl.make("https://mint.example"),
            quoteId: QuoteId.make(quoteId),
            paidAmount: Amount.make(40),
            feeReserve: NonNegativeAmount.make(2),
            feePaid: NonNegativeAmount.make(1),
            changeAmount: NonNegativeAmount.make(1),
          })
        : null,
  });

/** Evolu ids are 22 base64url characters; the test names are padded into that shape. */
const transactionId = (name: string) =>
  TransactionId.orThrow(name.padEnd(22, "A"));

const pendingRow = (
  id: string,
  quoteId: string | null,
  status: TransactionRecord["status"] = "pending",
): TransactionRecord => ({
  id: transactionId(id),
  ownerId: OwnerId.orThrow("AAAAAAAAAAAAAAAAAAAAAA"),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  isDeleted: null,
  createdAtSec: PositiveInt.orThrow(1),
  direction: "out",
  status,
  category: "lightning",
  amount: null,
  fee: null,
  method: NonEmptyString100.orThrow("lightning_invoice"),
  note: null,
  detailsJson:
    quoteId === null
      ? null
      : NonEmptyString100.orThrow(JSON.stringify({ meltQuoteId: quoteId })),
  iconKind: null,
  contactId: null,
  mint: null,
  unit: null,
  error: null,
  pendingLabel: null,
});

const mount = async (results: ReadonlyArray<MeltResumeResult>) => {
  const params: Params = {
    pushToast: vi.fn(),
    resumePendingCashuMelts: vi.fn(async () => results),
    t: (key) => key,
    transactions,
  };
  const Probe = () => {
    useMeltRecovery(params);
    return null;
  };
  const view = await renderIntoDocument(<Probe />);
  // The resume runs on mount; let its promise chain settle.
  await act(async () => {
    await Promise.resolve();
  });
  return { ...view, params };
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("useMeltRecovery", () => {
  it("marks the matching pending transaction paid with amount and fee", async () => {
    allMock.mockReturnValue([
      pendingRow("tx-other", "quote-9"),
      pendingRow("tx-settled", "quote-1", "ok"),
      pendingRow("tx-1", "quote-1"),
      pendingRow("tx-chat", null),
    ]);
    const view = await mount([result("paid")]);

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith(transactionId("tx-1"), {
      status: "ok",
      amount: 40,
      fee: 1,
    });
    expect(view.params.pushToast).toHaveBeenCalledWith("payPendingPaid");
    await act(async () => view.root.unmount());
  });

  it("marks an unpaid melt failed", async () => {
    allMock.mockReturnValue([pendingRow("tx-1", "quote-1")]);
    const view = await mount([result("unpaid")]);

    expect(updateMock).toHaveBeenCalledWith(transactionId("tx-1"), {
      status: "error",
      error: "Lightning payment failed",
    });
    expect(view.params.pushToast).toHaveBeenCalledWith("payPendingFailed");
    await act(async () => view.root.unmount());
  });

  it("touches nothing while the mint has not settled the payment", async () => {
    const view = await mount([result("pending"), result("unresolved")]);

    expect(allMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(view.params.pushToast).not.toHaveBeenCalled();
    await act(async () => view.root.unmount());
  });
});
