import {
  Amount,
  CurrencyUnit,
  DeferredReceiveResult,
  MintUrl,
  OperationId,
  ReceiveReceipt,
  TokenText,
} from "@linky-fit/linkshu";
import { transactionIdForOperation } from "@linky-fit/linksync";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as appLog from "../../../devtools/inspector/appLog";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { useDeferredReceiveRetry } from "./useDeferredReceiveRetry";

type Params = Parameters<typeof useDeferredReceiveRetry>[0];

const mint = MintUrl.make("https://mint.example");
const sat = CurrencyUnit.make("sat");
const receiveId = OperationId.make("AQEBAQEBAQEBAQEBAQEBAQ");

const result = (
  status: DeferredReceiveResult["status"],
  unit = sat,
): DeferredReceiveResult =>
  new DeferredReceiveResult({
    operationId: OperationId.make("AgICAgICAgICAgICAgICAg"),
    mint,
    unit,
    amount: Amount.make(21),
    status,
    receipt:
      status === "received"
        ? new ReceiveReceipt({
            operationId: receiveId,
            tokenText: TokenText.make("cashuBresigned"),
            mint,
            unit,
            amount: Amount.make(20),
          })
        : null,
  });

const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

/** `useDeferredOnlineReady` lets network work start 150 ms after mount. */
const passOnlineGate = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });

const mount = async (
  results: ReadonlyArray<DeferredReceiveResult>,
  deferredCount: number,
  resume: Params["resumeDeferredCashuReceives"] = vi.fn(async () => results),
  enqueueCashuOp: Params["enqueueCashuOp"] = (op) => op(),
) => {
  const params: Params = {
    deferredCount,
    enqueueCashuOp,
    formatDisplayedAmountParts: (amount) => ({
      amountText: String(amount),
      approxPrefix: "",
      unitLabel: "sat",
    }),
    isMintDeleted: () => false,
    logPaymentEvent: vi.fn(),
    mintInfoByUrl: new Map(),
    refreshMintInfo: vi.fn(async () => undefined),
    rememberCashuTokenKnown: vi.fn(),
    resumeDeferredCashuReceives: resume,
    showPaidOverlay: vi.fn(),
    t: (key) => (key === "paidReceived" ? "Received {amount} {unit}" : key),
    touchMintInfo: vi.fn(),
  };
  const Probe = () => {
    useDeferredReceiveRetry(params);
    return null;
  };
  const view = await renderIntoDocument(<Probe />);
  await settle();
  return { ...view, params };
};

const mountOnline = async (
  ...args: Parameters<typeof mount>
): ReturnType<typeof mount> => {
  const view = await mount(...args);
  await passOnlineGate();
  return view;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useDeferredReceiveRetry", () => {
  it("waits for startup network work before the first pass", async () => {
    const view = await mount([], 0);
    const resume = view.params.resumeDeferredCashuReceives;

    expect(resume).not.toHaveBeenCalled();
    await passOnlineGate();
    expect(resume).toHaveBeenCalledOnce();
    await view.unmount();
  });

  it("stops retrying while offline and runs one pass on coming back online", async () => {
    const view = await mountOnline([result("pending")], 1);
    const resume = view.params.resumeDeferredCashuReceives;

    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(resume).toHaveBeenCalledOnce();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(resume).toHaveBeenCalledTimes(2);
    await view.unmount();
  });

  it("never runs a second pass while one is still running", async () => {
    let finishPass = (): void => undefined;
    const resume = vi.fn(
      () =>
        new Promise<ReadonlyArray<DeferredReceiveResult>>((resolve) => {
          finishPass = () => resolve([result("pending")]);
        }),
    );
    const view = await mountOnline([], 1, resume);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(resume).toHaveBeenCalledOnce();
    await act(async () => {
      finishPass();
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(resume).toHaveBeenCalledTimes(2);
    await view.unmount();
  });

  it("announces a deferred token that landed like a live receive", async () => {
    const view = await mountOnline([result("received")], 1);

    expect(view.params.resumeDeferredCashuReceives).toHaveBeenCalledOnce();
    expect(view.params.logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: "in",
        status: "ok",
        transactionId: transactionIdForOperation(receiveId),
        amount: 20,
        method: "cashu_receive",
      }),
    );
    expect(view.params.showPaidOverlay).toHaveBeenCalledWith(
      "Received 20 sat",
      { direction: "in", amountSat: 20 },
    );
    expect(view.params.touchMintInfo).toHaveBeenCalledWith(
      mint,
      expect.any(Number),
    );
    expect(view.params.rememberCashuTokenKnown).toHaveBeenCalledWith(
      "cashuBresigned",
    );
    await view.unmount();
  });

  it("shows one overlay with the total when several deferred tokens land in one pass", async () => {
    const view = await mountOnline([result("received"), result("received")], 2);

    expect(view.params.logPaymentEvent).toHaveBeenCalledTimes(2);
    expect(view.params.showPaidOverlay).toHaveBeenCalledOnce();
    expect(view.params.showPaidOverlay).toHaveBeenCalledWith(
      "Received 40 sat",
      { direction: "in", amountSat: 40 },
    );
    await view.unmount();
  });

  it("leaves non-sat tokens out of the pass's overlay", async () => {
    const usd = CurrencyUnit.make("usd");
    const view = await mountOnline(
      [result("received"), result("received", usd)],
      2,
    );

    expect(view.params.logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ unit: usd, amount: 20 }),
    );
    expect(view.params.showPaidOverlay).toHaveBeenCalledOnce();
    expect(view.params.showPaidOverlay).toHaveBeenCalledWith(
      "Received 20 sat",
      { direction: "in", amountSat: 20 },
    );
    await view.unmount();
  });

  it("shows no overlay for a pass that received only non-sat tokens", async () => {
    const view = await mountOnline(
      [result("received", CurrencyUnit.make("usd"))],
      1,
    );

    expect(view.params.logPaymentEvent).toHaveBeenCalledOnce();
    expect(view.params.showPaidOverlay).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("runs a pass in the wallet queue, after the receive ahead of it", async () => {
    let freeQueue = (): void => undefined;
    const queueFree = new Promise<void>((resolve) => {
      freeQueue = resolve;
    });
    const resume = vi.fn(async () => [result("pending")]);
    const view = await mountOnline([], 1, resume, async (op) => {
      await queueFree;
      return op();
    });

    expect(resume).not.toHaveBeenCalled();
    await act(async () => {
      freeQueue();
      await Promise.resolve();
    });
    expect(resume).toHaveBeenCalledOnce();
    await view.unmount();
  });

  it("stays silent about deferrals that closed or still wait", async () => {
    const view = await mountOnline([result("closed"), result("pending")], 1);

    expect(view.params.logPaymentEvent).not.toHaveBeenCalled();
    expect(view.params.showPaidOverlay).not.toHaveBeenCalled();
    expect(view.params.touchMintInfo).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("reports a pass that rejects to the inspector and keeps retrying", async () => {
    const reported = vi.spyOn(appLog, "reportAppLog");
    const resume = vi
      .fn<() => Promise<ReadonlyArray<DeferredReceiveResult>>>()
      .mockRejectedValueOnce(new Error("runtime shut down"))
      .mockResolvedValue([result("pending")]);
    const view = await mountOnline([], 1, resume);

    expect(reported).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: "receive.resumeDeferredRejected",
        payload: { error: "runtime shut down" },
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(resume).toHaveBeenCalledTimes(2);
    await view.unmount();
  });

  it("retries on a growing interval while deferrals are pending", async () => {
    const view = await mountOnline([result("pending")], 1);
    const resume = view.params.resumeDeferredCashuReceives;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(resume).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(resume).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(resume).toHaveBeenCalledTimes(3);
    await view.unmount();
  });

  it("runs no timer without pending deferrals, but retries on coming online", async () => {
    const view = await mountOnline([], 0);
    const resume = view.params.resumeDeferredCashuReceives;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(resume).toHaveBeenCalledOnce();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(resume).toHaveBeenCalledTimes(2);
    await view.unmount();
  });
});
