import {
  Amount,
  MeltReceipt,
  MeltResumeResult,
  MintUrl,
  NonNegativeAmount,
  OperationId,
  QuoteId,
  StoredOperation,
} from "@linky-fit/linkshu";
import {
  OwnerId,
  TransactionId,
  transactionIdForOperation,
  type TransactionRecord,
} from "@linky-fit/linksync";
import { Effect, Schema } from "effect";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { useMeltRecovery } from "./useMeltRecovery";

type Params = Parameters<typeof useMeltRecovery>[0];

const updateMock = vi.fn<Params["transactions"]["update"]>(() => Effect.void);

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

const meltOperation = (
  id: string,
  status: StoredOperation["status"] = "pending",
): StoredOperation =>
  Schema.decodeUnknownSync(StoredOperation)({
    id,
    kind: "melt",
    status,
    mint: "https://mint.example",
    unit: "sat",
    keysetId: null,
    amount: 40,
    feeReserve: 2,
    inputsTotal: 43,
    quoteId: `quote-${id}`,
    invoice: null,
    sourceMint: null,
    counter: null,
    locked: null,
    expiresAt: null,
    createdAt: 1_700_000_000,
    tokenText: null,
    error: null,
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
  createdAtSec: 1,
  direction: "out",
  status,
  category: "lightning",
  amount: null,
  fee: null,
  method: "lightning_invoice",
  note: null,
  detailsJson:
    quoteId === null ? null : JSON.stringify({ meltQuoteId: quoteId }),
  iconKind: null,
  contactId: null,
  mint: "https://mint.example",
  unit: null,
  error: null,
  pendingLabel: null,
});

let visibility: DocumentVisibilityState = "visible";

const setVisibility = async (next: DocumentVisibilityState) => {
  visibility = next;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

const setOnline = async (online: boolean) => {
  await act(async () => {
    window.dispatchEvent(new Event(online ? "online" : "offline"));
  });
};

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const mount = async (
  initial: {
    results?: ReadonlyArray<MeltResumeResult>;
    operations?: ReadonlyArray<StoredOperation>;
    records?: ReadonlyArray<TransactionRecord>;
  } = {},
) => {
  const resumePendingCashuMelts = vi.fn<
    NonNullable<Params["resumePendingCashuMelts"]>
  >(async () => initial.results ?? []);
  const pushToast = vi.fn();
  const paramsWith = (
    operations: ReadonlyArray<StoredOperation>,
    records: ReadonlyArray<TransactionRecord>,
  ): Params => ({
    operations,
    pushToast,
    records,
    resumePendingCashuMelts,
    t: (key) => key,
    transactions: { update: updateMock },
  });
  const Probe = (props: { params: Params }) => {
    useMeltRecovery(props.params);
    return null;
  };
  const view = await renderIntoDocument(
    <Probe
      params={paramsWith(initial.operations ?? [], initial.records ?? [])}
    />,
  );
  // The launch pass runs on mount; let its promise chain settle.
  await act(async () => {
    await Promise.resolve();
  });
  return {
    ...view,
    pushToast,
    resumePendingCashuMelts,
    rerenderWith: (
      operations: ReadonlyArray<StoredOperation>,
      records: ReadonlyArray<TransactionRecord> = [],
    ) => view.rerender(<Probe params={paramsWith(operations, records)} />),
  };
};

beforeEach(() => {
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("useMeltRecovery history", () => {
  it("marks the matching pending transaction paid with amount and fee", async () => {
    const view = await mount({
      results: [result("paid")],
      records: [
        pendingRow("tx-other", "quote-9"),
        pendingRow("tx-settled", "quote-1", "ok"),
        pendingRow("tx-1", "quote-1"),
        pendingRow("tx-chat", null),
      ],
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith(transactionId("tx-1"), {
      status: "ok",
      amount: 40,
      fee: 1,
    });
    expect(view.pushToast).toHaveBeenCalledWith("payPendingPaid");
    await view.unmount();
  });

  it("keeps updating rows and toasting when one row's update fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    updateMock.mockImplementationOnce(() => Effect.die(new Error("quota")));
    const view = await mount({
      results: [result("paid"), result("unpaid", "quote-2")],
      records: [pendingRow("tx-1", "quote-1"), pendingRow("tx-2", "quote-2")],
    });

    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenLastCalledWith(transactionId("tx-2"), {
      status: "error",
      error: "Lightning payment failed",
    });
    expect(view.pushToast).toHaveBeenCalledWith("payPendingPaid");
    expect(view.pushToast).toHaveBeenCalledWith("payPendingFailed");
    await view.unmount();
  });

  it("leaves a pending row of the same quote at another mint alone", async () => {
    const view = await mount({
      results: [result("paid")],
      records: [
        { ...pendingRow("tx-1", "quote-1"), mint: "https://other.example" },
      ],
    });

    expect(updateMock).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("marks an unpaid melt failed", async () => {
    const view = await mount({
      results: [result("unpaid")],
      records: [pendingRow("tx-1", "quote-1")],
    });

    expect(updateMock).toHaveBeenCalledWith(transactionId("tx-1"), {
      status: "error",
      error: "Lightning payment failed",
    });
    expect(view.pushToast).toHaveBeenCalledWith("payPendingFailed");
    await view.unmount();
  });

  it("touches nothing while the mint has not settled the payment", async () => {
    const view = await mount({
      results: [result("pending"), result("unresolved")],
      records: [pendingRow("tx-1", "quote-1")],
    });

    expect(updateMock).not.toHaveBeenCalled();
    expect(view.pushToast).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("settles a pending row whose melt closed before the row was written, without a second toast", async () => {
    const paid = meltOperation("op-paid", "paid");
    const unpaid = meltOperation("op-unpaid", "unpaid");
    const view = await mount({ operations: [paid, unpaid] });
    expect(view.resumePendingCashuMelts).toHaveBeenCalledTimes(1);

    // The payer's pending rows land after a pass already closed both melts.
    await view.rerenderWith(
      [paid, unpaid],
      [
        {
          ...pendingRow("ignored", null),
          id: transactionIdForOperation(paid.id),
        },
        pendingRow("tx-unpaid", "quote-op-unpaid"),
      ],
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(view.resumePendingCashuMelts).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenCalledWith(
      transactionIdForOperation(paid.id),
      { status: "ok", amount: 40 },
    );
    expect(updateMock).toHaveBeenCalledWith(transactionId("tx-unpaid"), {
      status: "error",
      error: "Lightning payment failed",
    });
    expect(view.pushToast).not.toHaveBeenCalled();
    await view.unmount();
  });
});

describe("useMeltRecovery checks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("checks every 3 s for the first minute of a pending melt, then every 30 s", async () => {
    const view = await mount({ operations: [meltOperation("op-1")] });
    const calls = () => view.resumePendingCashuMelts.mock.calls.length;
    // The launch pass and the first check share one pass.
    expect(calls()).toBe(1);

    await advance(3_000);
    expect(calls()).toBe(2);
    await advance(57_000);
    expect(calls()).toBe(21);
    await advance(3_000);
    // Past the first minute: the check after 60 s waits 30 s.
    const afterFast = calls();
    await advance(27_000);
    expect(calls()).toBe(afterFast + 1);
    await advance(30_000);
    expect(calls()).toBe(afterFast + 2);
    await view.unmount();
  });

  it("pauses while hidden and checks at once, at the fast pace, on return", async () => {
    const view = await mount({ operations: [meltOperation("op-1")] });
    const calls = () => view.resumePendingCashuMelts.mock.calls.length;
    await advance(90_000);

    await setVisibility("hidden");
    const hiddenAt = calls();
    await advance(120_000);
    expect(calls()).toBe(hiddenAt);

    await setVisibility("visible");
    expect(calls()).toBe(hiddenAt + 1);
    await advance(3_000);
    expect(calls()).toBe(hiddenAt + 2);
    await view.unmount();
  });

  it("pauses while offline and checks at once when back online", async () => {
    const view = await mount({ operations: [meltOperation("op-1")] });
    const calls = () => view.resumePendingCashuMelts.mock.calls.length;

    await setOnline(false);
    const offlineAt = calls();
    await advance(120_000);
    expect(calls()).toBe(offlineAt);

    await setOnline(true);
    expect(calls()).toBe(offlineAt + 1);
    await advance(3_000);
    expect(calls()).toBe(offlineAt + 2);
    await view.unmount();
  });

  it("stops once no melt is pending", async () => {
    const view = await mount({ operations: [meltOperation("op-1")] });
    const calls = () => view.resumePendingCashuMelts.mock.calls.length;

    await view.rerenderWith([meltOperation("op-1", "paid")]);
    const settledAt = calls();
    await advance(120_000);
    expect(calls()).toBe(settledAt);
    await view.unmount();
  });

  it("does not check without a pending melt", async () => {
    const view = await mount();
    await advance(120_000);
    expect(view.resumePendingCashuMelts).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("restarts the fast pace when another melt turns pending", async () => {
    const first = meltOperation("op-1");
    const view = await mount({ operations: [first] });
    const calls = () => view.resumePendingCashuMelts.mock.calls.length;
    await advance(90_000);

    const before = calls();
    await view.rerenderWith([first, meltOperation("op-2")]);
    expect(calls()).toBe(before + 1);
    await advance(3_000);
    expect(calls()).toBe(before + 2);
    await view.unmount();
  });

  it("never runs two passes at once", async () => {
    const view = await mount({ operations: [meltOperation("op-1")] });
    view.resumePendingCashuMelts.mockImplementation(
      () => new Promise(() => {}),
    );
    await advance(3_000);
    const stuckAt = view.resumePendingCashuMelts.mock.calls.length;

    await advance(120_000);
    await setVisibility("hidden");
    await setVisibility("visible");
    await setOnline(true);
    expect(view.resumePendingCashuMelts).toHaveBeenCalledTimes(stuckAt);
    await view.unmount();
  });
});
