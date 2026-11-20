import { OwnerId } from "@linky-fit/linksync";
import {
  Amount,
  MeltReceipt,
  MeltResumeResult,
  MintUrl,
  NonNegativeAmount,
  QuoteId,
  OperationId,
} from "@linky-fit/linkshu";
import {
  NonEmptyString100,
  NonEmptyString1000,
  PositiveInt,
  TransactionId,
  type TransactionRecord,
} from "@linky-fit/linksync";
import { Effect, Option } from "effect";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as appLog from "../../../devtools/inspector/appLog";
import { makeWalletOps } from "../../state/wallet/opQueue";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import {
  FIRST_RECHECK_MS,
  MAX_RECHECK_MS,
  useMeltRecovery,
} from "./useMeltRecovery";

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
  mint: NonEmptyString1000.orThrow("https://mint.example"),
  unit: null,
  error: null,
  pendingLabel: null,
});

const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

let visibility: DocumentVisibilityState = "visible";
const setVisibility = (next: DocumentVisibilityState) =>
  act(async () => {
    visibility = next;
    document.dispatchEvent(new Event("visibilitychange"));
  });

const dispatchWindow = (type: "online" | "offline") =>
  act(async () => {
    window.dispatchEvent(new Event(type));
  });

interface MountOptions {
  pendingMeltIds?: ReadonlyArray<string>;
  resume?: Params["resumePendingCashuMelts"];
  runQueued?: Params["runQueued"];
}

const mount = async (
  results: ReadonlyArray<MeltResumeResult>,
  options: MountOptions = {},
) => {
  const params: Params = {
    pendingMeltIds: options.pendingMeltIds ?? [],
    pushToast: vi.fn(),
    resumePendingCashuMelts: options.resume ?? vi.fn(async () => results),
    runQueued: options.runQueued ?? makeWalletOps(() => {}).runQueuedTask,
    t: (key) => key,
    transactions,
  };
  const Probe = ({ current }: { current: Params }) => {
    useMeltRecovery(current);
    return null;
  };
  const view = await renderIntoDocument(<Probe current={params} />);
  // The resume runs on mount; let its promise chain settle.
  await settle();
  const setPending = (pendingMeltIds: ReadonlyArray<string>) =>
    view.rerender(<Probe current={{ ...params, pendingMeltIds }} />);
  return { ...view, params, setPending };
};

beforeEach(() => {
  vi.useFakeTimers();
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
    await view.unmount();
  });

  it("leaves a pending row of the same quote at another mint alone", async () => {
    allMock.mockReturnValue([
      {
        ...pendingRow("tx-1", "quote-1"),
        mint: NonEmptyString1000.orThrow("https://other.example"),
      },
    ]);
    const view = await mount([result("paid")]);

    expect(updateMock).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("marks an unpaid melt failed", async () => {
    allMock.mockReturnValue([pendingRow("tx-1", "quote-1")]);
    const view = await mount([result("unpaid")]);

    expect(updateMock).toHaveBeenCalledWith(transactionId("tx-1"), {
      status: "error",
      error: "Lightning payment failed",
    });
    expect(view.params.pushToast).toHaveBeenCalledWith("payPendingFailed");
    await view.unmount();
  });

  it("touches nothing while the mint has not settled the payment", async () => {
    const view = await mount([result("pending"), result("unresolved")]);

    expect(allMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(view.params.pushToast).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("marks a payment paid once a timed re-check finds the mint settled it", async () => {
    allMock.mockReturnValue([pendingRow("tx-1", "quote-1")]);
    const resume = vi
      .fn<() => Promise<ReadonlyArray<MeltResumeResult>>>()
      .mockResolvedValueOnce([result("pending")])
      .mockResolvedValue([result("paid")]);
    const view = await mount([], { pendingMeltIds: ["op-1"], resume });
    expect(updateMock).not.toHaveBeenCalled();

    await advance(FIRST_RECHECK_MS);

    expect(resume).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenCalledWith(
      transactionId("tx-1"),
      expect.objectContaining({ status: "ok" }),
    );
    expect(view.params.pushToast).toHaveBeenCalledWith("payPendingPaid");
    await view.unmount();
  });

  it("re-checks on a growing backoff capped at a minute and stops once nothing is pending", async () => {
    const resume = vi.fn(async () => [result("pending")]);
    const view = await mount([], { pendingMeltIds: ["op-1"], resume });
    expect(resume).toHaveBeenCalledTimes(1);

    await advance(FIRST_RECHECK_MS - 1);
    expect(resume).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(resume).toHaveBeenCalledTimes(2);
    await advance(7_500);
    expect(resume).toHaveBeenCalledTimes(3);
    await advance(11_250);
    expect(resume).toHaveBeenCalledTimes(4);
    // Long past the growth phase, one re-check per minute.
    await advance(10 * MAX_RECHECK_MS);
    const settledCount = resume.mock.calls.length;
    await advance(MAX_RECHECK_MS);
    expect(resume).toHaveBeenCalledTimes(settledCount + 1);

    await view.setPending([]);
    await advance(10 * MAX_RECHECK_MS);
    expect(resume).toHaveBeenCalledTimes(settledCount + 1);
    await view.unmount();
  });

  it("does not re-check when no melt is pending", async () => {
    const view = await mount([]);

    await advance(10 * MAX_RECHECK_MS);
    await setVisibility("hidden");
    await setVisibility("visible");
    expect(view.params.resumePendingCashuMelts).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("starts the backoff over when another melt goes pending", async () => {
    const view = await mount([result("pending")], {
      pendingMeltIds: ["op-1"],
    });
    const resume = view.params.resumePendingCashuMelts;
    await advance(FIRST_RECHECK_MS + 7_500 + 11_250);
    expect(resume).toHaveBeenCalledTimes(4);

    await view.setPending(["op-1", "op-2"]);
    await advance(FIRST_RECHECK_MS);
    expect(resume).toHaveBeenCalledTimes(5);
    await view.unmount();
  });

  it("pauses while the page is hidden and re-checks at once when it is visible again", async () => {
    const view = await mount([result("pending")], {
      pendingMeltIds: ["op-1"],
    });
    const resume = view.params.resumePendingCashuMelts;

    await setVisibility("hidden");
    await advance(10 * MAX_RECHECK_MS);
    expect(resume).toHaveBeenCalledTimes(1);

    await setVisibility("visible");
    await settle();
    expect(resume).toHaveBeenCalledTimes(2);
    await advance(FIRST_RECHECK_MS);
    expect(resume).toHaveBeenCalledTimes(3);
    await view.unmount();
  });

  it("pauses while offline and re-checks on coming back online", async () => {
    const view = await mount([result("pending")], {
      pendingMeltIds: ["op-1"],
    });
    const resume = view.params.resumePendingCashuMelts;

    await dispatchWindow("offline");
    await advance(10 * MAX_RECHECK_MS);
    expect(resume).toHaveBeenCalledTimes(1);

    await dispatchWindow("online");
    await settle();
    expect(resume).toHaveBeenCalledTimes(2);
    await advance(FIRST_RECHECK_MS);
    expect(resume).toHaveBeenCalledTimes(3);
    await view.unmount();
  });

  it("never runs a second pass while one is still running", async () => {
    let finishPass = (): void => undefined;
    const resume = vi.fn(
      () =>
        new Promise<ReadonlyArray<MeltResumeResult>>((resolve) => {
          finishPass = () => resolve([result("pending")]);
        }),
    );
    const view = await mount([], { pendingMeltIds: ["op-1"], resume });

    await advance(10 * MAX_RECHECK_MS);
    await setVisibility("hidden");
    await setVisibility("visible");
    await dispatchWindow("online");
    expect(resume).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishPass();
    });
    await advance(FIRST_RECHECK_MS);
    expect(resume).toHaveBeenCalledTimes(2);
    await view.unmount();
  });

  it("re-checks in the background of the wallet queue, never dropping a payment", async () => {
    const ops = makeWalletOps(() => {});
    let finishPass = (): void => undefined;
    const resume = vi
      .fn<() => Promise<ReadonlyArray<MeltResumeResult>>>()
      .mockResolvedValueOnce([result("pending")])
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            finishPass = () => resolve([result("pending")]);
          }),
      );
    const view = await mount([], {
      pendingMeltIds: ["op-1"],
      resume,
      runQueued: ops.runQueuedTask,
    });
    await advance(FIRST_RECHECK_MS);
    expect(resume).toHaveBeenCalledTimes(2);

    // A user payment started during the pass runs instead of being dropped.
    const payment = await ops.runExclusiveTask(async () => "paid");
    expect(payment).toEqual(Option.some("paid"));

    await act(async () => {
      finishPass();
    });
    await view.unmount();
  });

  it("waits for the queued receive ahead of it", async () => {
    let freeQueue = (): void => undefined;
    const queueFree = new Promise<void>((resolve) => {
      freeQueue = resolve;
    });
    const view = await mount([result("pending")], {
      pendingMeltIds: ["op-1"],
      runQueued: async (task) => {
        await queueFree;
        return task();
      },
    });
    const resume = view.params.resumePendingCashuMelts;
    expect(resume).not.toHaveBeenCalled();

    await act(async () => {
      freeQueue();
      await Promise.resolve();
    });
    expect(resume).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("reports each pass to the inspector with its trigger and pending melts", async () => {
    const reported = vi.spyOn(appLog, "reportAppLog");
    const view = await mount([result("pending")], {
      pendingMeltIds: ["op-1"],
    });
    await advance(FIRST_RECHECK_MS);

    expect(reported).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: "melt.recheckPending",
        links: { operation: ["op-1"] },
        payload: { trigger: "timer", pendingMelts: 1 },
      }),
    );
    await view.unmount();
  });

  it("reports a pass that rejects and keeps re-checking", async () => {
    const reported = vi.spyOn(appLog, "reportAppLog");
    const resume = vi
      .fn<() => Promise<ReadonlyArray<MeltResumeResult>>>()
      .mockRejectedValueOnce(new Error("runtime disposed"))
      .mockResolvedValue([result("pending")]);
    const view = await mount([], { pendingMeltIds: ["op-1"], resume });

    expect(reported).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: "melt.resumePendingRejected",
        payload: { error: "runtime disposed" },
      }),
    );
    await advance(FIRST_RECHECK_MS);
    expect(resume).toHaveBeenCalledTimes(2);
    await view.unmount();
  });
});
