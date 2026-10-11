import { AutoswapEstimate, AutoswapReceipt } from "@linky-fit/linkshu";
import { Result, Schema } from "effect";
import { act, useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type {
  AutoswapCashu,
  EstimateAutoswapCashu,
} from "../composition/useLinkshuComposition";
import { useMoveMintFunds } from "./useMoveMintFunds";

const APP_SOURCE = "https://mint.example.com";
const TARGET = "https://cashu.cz";

const renderMoveFunds = async (first: string, second: string) => {
  const resolveAutoswapSource = vi
    .fn<(mint: string) => Promise<string>>()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second);
  const estimateAutoswapCashu = vi.fn<EstimateAutoswapCashu>(async (args) =>
    Result.succeed(
      Schema.decodeUnknownSync(AutoswapEstimate)({
        sourceMint: args.sourceMint,
        targetMint: args.targetMint,
        amount: 50,
        lightningFeeReserve: 2,
        inputFee: 1,
        totalFromSource: 53,
      }),
    ),
  );
  const autoswapCashu = vi.fn<AutoswapCashu>(async (args) =>
    Result.succeed(
      Schema.decodeUnknownSync(AutoswapReceipt)({
        sourceMint: args.sourceMint,
        targetMint: args.targetMint,
        movedAmount: 50,
        feePaid: 3,
        operationId: "AAAAAAAAAAAAAAAAAAAAAA",
      }),
    ),
  );
  let moveFunds: ReturnType<typeof useMoveMintFunds> | null = null;
  const Probe = () => {
    const hook = useMoveMintFunds({
      autoswapCashu,
      cashuIsBusy: false,
      estimateAutoswapCashu,
      formatDisplayedAmountParts: (amountSat) => ({
        amountText: String(amountSat),
        approxPrefix: "",
        unitLabel: "sat",
      }),
      rememberSeenMint: () => {},
      resolveAutoswapSource,
      setCashuIsBusy: () => {},
      setStatus: () => {},
      t: (key) => key,
    });
    useEffect(() => {
      moveFunds = hook;
    }, [hook]);
    return null;
  };
  const rendered = await renderIntoDocument(<Probe />);
  const current = () => {
    if (moveFunds === null) throw new Error("hook not rendered");
    return moveFunds;
  };
  return {
    ...rendered,
    autoswapCashu,
    current,
    estimateAutoswapCashu,
    resolveAutoswapSource,
  };
};

describe("useMoveMintFunds", () => {
  it("claims from the spelling the estimate priced, even after balances shift", async () => {
    // A second resolution would now pick another spelling.
    const moveFunds = await renderMoveFunds(
      "https://Mint.Example.com",
      "https://MINT.example.com",
    );
    const move = { sourceMint: APP_SOURCE, targetMint: TARGET };

    const estimate = await act(() =>
      moveFunds.current().estimateMintMove(move),
    );
    if (estimate === null) throw new Error("estimate failed");
    await act(() =>
      moveFunds
        .current()
        .moveMintFunds({ ...move, sourceMint: estimate.sourceMint }),
    );

    expect(moveFunds.resolveAutoswapSource).toHaveBeenCalledTimes(1);
    expect(moveFunds.estimateAutoswapCashu).toHaveBeenCalledWith({
      ...move,
      sourceMint: "https://Mint.Example.com",
    });
    expect(moveFunds.autoswapCashu).toHaveBeenCalledWith({
      ...move,
      sourceMint: "https://Mint.Example.com",
    });
    await moveFunds.unmount();
  });
});
