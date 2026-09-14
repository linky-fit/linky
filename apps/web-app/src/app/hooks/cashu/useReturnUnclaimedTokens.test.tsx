import { ReceiveReceipt, TokenTransfer } from "@linky/linkshu";
import { Either, Schema } from "effect";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  selectUnclaimedCandidates,
  useReturnUnclaimedTokens,
  type ReturnUnclaimedTokensOptions,
  type ReturnUnclaimedTokensReport,
} from "./useReturnUnclaimedTokens";

vi.mock("../../lib/cashuSendInspector", () => ({
  reportCashuUnclaimedReturned: vi.fn(),
}));

const transfer = (
  id: string,
  overrides: Partial<{
    kind: "send" | "receive";
    status: string;
    amount: number;
    createdAt: number;
  }> = {},
) =>
  Schema.decodeUnknownSync(TokenTransfer)({
    id,
    kind: overrides.kind ?? "send",
    status: overrides.status ?? "issued",
    tokenText: `cashuB${id}`,
    mint: "https://mint.example",
    unit: "sat",
    amount: overrides.amount ?? 21,
    error: null,
    createdAt: overrides.createdAt ?? 1_000,
  });

const issuedOld = transfer("AQEBAQEBAQEBAQEBAQEBAQ", {
  amount: 1_500_000,
  createdAt: 1_000,
});
const issuedFresh = transfer("AgICAgICAgICAgICAgICAg", {
  amount: 5,
  createdAt: 2_000_000_000,
});
const pendingSend = transfer("AwMDAwMDAwMDAwMDAwMDAw", { status: "pending" });
const failedReceive = transfer("BAQEBAQEBAQEBAQEBAQEBA", {
  kind: "receive",
  status: "failed",
});

type ReturnUnclaimed = (
  options: ReturnUnclaimedTokensOptions,
) => Promise<ReturnUnclaimedTokensReport>;

interface HookOverrides {
  transfers?: readonly TokenTransfer[];
  checkIssuedClaims?: () => Promise<{ claimed: ReadonlyArray<{ id: string }> }>;
  returnToWallet?: (
    operationId: string,
  ) => Promise<Either.Either<ReceiveReceipt, { readonly _tag: string }>>;
  runtimeReady?: boolean;
  pushToast?: (message: string) => void;
}

const renderHook = (overrides: HookOverrides): ReturnUnclaimed => {
  const ref: { current: ReturnUnclaimed } = {
    current: () => Promise.reject(new Error("not rendered")),
  };
  const ready = overrides.runtimeReady ?? true;
  const Harness: React.FC = () => {
    const returnUnclaimed = useReturnUnclaimedTokens({
      cashuIsBusy: false,
      cashuOpenTransfers: overrides.transfers ?? [],
      checkIssuedClaims: ready
        ? (overrides.checkIssuedClaims ??
          (() => Promise.resolve({ claimed: [] })))
        : null,
      enqueueCashuOp: (op) => op(),
      formatDisplayedAmountText: (amount) => `${amount} sat`,
      pushToast: overrides.pushToast ?? (() => {}),
      returnToWallet: ready
        ? (overrides.returnToWallet ??
          (() => Promise.resolve(Either.left({ _tag: "unexpected" }))))
        : null,
      setCashuIsBusy: () => {},
      setTokensReturnIsBusy: () => {},
      t: (key) => key,
      tokensReturnIsBusy: false,
    });
    React.useEffect(() => {
      ref.current = returnUnclaimed;
    }, [returnUnclaimed]);
    return null;
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(<Harness />);
  });
  return (options) => ref.current(options);
};

const receipt = Schema.decodeUnknownSync(ReceiveReceipt)({
  operationId: "AQEBAQEBAQEBAQEBAQEBAQ",
  tokenText: "cashuBreturned",
  mint: "https://mint.example",
  unit: "sat",
  amount: 21,
});
const right = () => Promise.resolve(Either.right(receipt));
const left = (tag: string) => Promise.resolve(Either.left({ _tag: tag }));

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("selectUnclaimedCandidates", () => {
  it("keeps only issued sends, optionally older than the cutoff", () => {
    const all = [issuedOld, issuedFresh, pendingSend, failedReceive];
    expect(selectUnclaimedCandidates(all, undefined, 3_000_000_000)).toEqual([
      issuedOld,
      issuedFresh,
    ]);
    expect(
      selectUnclaimedCandidates(all, 24 * 3600, 2_000_000_000 + 3600),
    ).toEqual([issuedOld]);
  });
});

describe("useReturnUnclaimedTokens", () => {
  it("returns every issued send and reports the total", async () => {
    const returnToWallet = vi.fn<(id: string) => ReturnType<typeof right>>(() =>
      right(),
    );
    const pushToast = vi.fn();
    const run = renderHook({
      transfers: [issuedOld, issuedFresh, pendingSend],
      returnToWallet,
      pushToast,
    });

    let report: ReturnUnclaimedTokensReport | undefined;
    await act(async () => {
      report = await run({ reason: "manual" });
    });

    expect(returnToWallet.mock.calls.map(([id]) => id)).toEqual([
      String(issuedOld.id),
      String(issuedFresh.id),
    ]);
    expect(report).toMatchObject({
      returned: 2,
      returnedAmount: 1_500_005,
      claimed: 0,
      failed: 0,
    });
    expect(pushToast).toHaveBeenCalledWith("cashuReturnUnclaimedDone");
  });

  it("skips sends the mint already reports claimed and counts a late claim", async () => {
    const returnToWallet = vi.fn((id: string) =>
      id === String(issuedFresh.id) ? left("TokenAlreadySpent") : right(),
    );
    const run = renderHook({
      transfers: [issuedOld, issuedFresh, pendingSend],
      checkIssuedClaims: () =>
        Promise.resolve({ claimed: [{ id: String(pendingSend.id) }] }),
      returnToWallet,
    });

    let report: ReturnUnclaimedTokensReport | undefined;
    await act(async () => {
      report = await run({ reason: "manual" });
    });

    expect(returnToWallet).toHaveBeenCalledTimes(2);
    expect(report).toMatchObject({ returned: 1, claimed: 1, failed: 0 });
  });

  it("stops the pass when the mint stops answering", async () => {
    const returnToWallet = vi.fn((id: string) =>
      id === String(issuedOld.id) ? left("MintUnreachable") : right(),
    );
    const run = renderHook({
      transfers: [issuedOld, issuedFresh],
      returnToWallet,
    });

    let report: ReturnUnclaimedTokensReport | undefined;
    await act(async () => {
      report = await run({ reason: "manual" });
    });

    expect(returnToWallet).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({
      returned: 0,
      failed: 1,
      mintUnreachable: true,
    });
  });

  it("only touches sends older than the window and stays quiet when nothing qualifies", async () => {
    const returnToWallet = vi.fn<(id: string) => ReturnType<typeof right>>(() =>
      right(),
    );
    const checkIssuedClaims = vi.fn(() => Promise.resolve({ claimed: [] }));
    const pushToast = vi.fn();
    const run = renderHook({
      transfers: [issuedFresh],
      checkIssuedClaims,
      returnToWallet,
      pushToast,
    });

    await act(async () => {
      await run({ reason: "auto", olderThanSec: 3600 });
    });

    expect(checkIssuedClaims).not.toHaveBeenCalled();
    expect(returnToWallet).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it("tells a manual run when there is nothing to return", async () => {
    const pushToast = vi.fn();
    const run = renderHook({ transfers: [pendingSend], pushToast });

    await act(async () => {
      await run({ reason: "manual" });
    });

    expect(pushToast).toHaveBeenCalledWith("cashuReturnUnclaimedNothing");
  });

  it("reports a missing runtime as a missing seed", async () => {
    const pushToast = vi.fn();
    const run = renderHook({
      transfers: [issuedOld],
      runtimeReady: false,
      pushToast,
    });

    await act(async () => {
      await run({ reason: "manual" });
    });

    expect(pushToast).toHaveBeenCalledWith("seedMissing");
  });
});
