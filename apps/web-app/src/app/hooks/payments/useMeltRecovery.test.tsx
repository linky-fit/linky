import * as Evolu from "@evolu/common";
import {
  Amount,
  MeltReceipt,
  MeltResumeResult,
  MintUrl,
  NonNegativeAmount,
  QuoteId,
  OperationId,
} from "@linky/linkshu";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { useMeltRecovery } from "./useMeltRecovery";

interface PendingTransactionRow {
  readonly detailsJson: string | null;
  readonly id: string;
  readonly ownerId: Evolu.OwnerId;
}

const { loadQueryMock } = vi.hoisted(() => ({
  loadQueryMock: vi.fn<() => Promise<ReadonlyArray<PendingTransactionRow>>>(),
}));

vi.mock("../../../evolu", () => ({
  evolu: {
    createQuery: () => "pending-transactions",
    loadQuery: loadQueryMock,
  },
}));

type Params = Parameters<typeof useMeltRecovery>[0];

const owner = Evolu.createAppOwner(
  Evolu.OwnerSecret.orThrow(new Uint8Array(32).fill(7)),
);

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

const pendingRow = (
  id: string,
  quoteId: string | null,
): PendingTransactionRow => ({
  id,
  ownerId: owner.id,
  detailsJson:
    quoteId === null ? null : JSON.stringify({ meltQuoteId: quoteId }),
});

const mount = async (results: ReadonlyArray<MeltResumeResult>) => {
  const params: Params = {
    pushToast: vi.fn(),
    resumePendingCashuMelts: vi.fn(async () => results),
    t: (key) => key,
    transactionsOwnerId: null,
    update: vi.fn<Params["update"]>(),
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
    loadQueryMock.mockResolvedValue([
      pendingRow("tx-other", "quote-9"),
      pendingRow("tx-1", "quote-1"),
      pendingRow("tx-chat", null),
    ]);
    const view = await mount([result("paid")]);

    expect(view.params.update).toHaveBeenCalledTimes(1);
    expect(view.params.update).toHaveBeenCalledWith(
      "transaction",
      { id: "tx-1", status: "ok", amount: 40, fee: 1 },
      { ownerId: owner.id },
    );
    expect(view.params.pushToast).toHaveBeenCalledWith("payPendingPaid");
    await act(async () => view.root.unmount());
  });

  it("marks an unpaid melt failed", async () => {
    loadQueryMock.mockResolvedValue([pendingRow("tx-1", "quote-1")]);
    const view = await mount([result("unpaid")]);

    expect(view.params.update).toHaveBeenCalledWith(
      "transaction",
      { id: "tx-1", status: "error", error: "Lightning payment failed" },
      { ownerId: owner.id },
    );
    expect(view.params.pushToast).toHaveBeenCalledWith("payPendingFailed");
    await act(async () => view.root.unmount());
  });

  it("touches nothing while the mint has not settled the payment", async () => {
    const view = await mount([result("pending"), result("unresolved")]);

    expect(loadQueryMock).not.toHaveBeenCalled();
    expect(view.params.update).not.toHaveBeenCalled();
    expect(view.params.pushToast).not.toHaveBeenCalled();
    await act(async () => view.root.unmount());
  });
});
