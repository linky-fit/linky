import { createIdFromString } from "@linky/linksync";
import { NonNegativeAmount, ProofId, ReclaimReport } from "@linky/linkshu";
import { act, useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type { CashuTransferLifecycle } from "../composition/useLinkshuComposition";
import { useReclaimCashuTransfer } from "./useReclaimCashuTransfer";

const tokenId = createIdFromString<"CashuOperation">("chat-token");
const report = new ReclaimReport({
  reclaimedAmount: NonNegativeAmount.make(20),
  reclaimedProofs: [ProofId.make("proof")],
  spentProofs: [],
  unresolvedProofs: [],
});

const mount = async (reclaim: CashuTransferLifecycle["reclaim"]) => {
  const pushToast = vi.fn();
  const setCashuIsBusy = vi.fn();
  let returnToken = async () => {};
  const Harness = () => {
    const callback = useReclaimCashuTransfer({
      busy: false,
      enqueueCashuOp: (op) => op(),
      reclaim,
      setCashuIsBusy,
      pushToast,
      t: (key) => key,
    });
    useEffect(() => {
      returnToken = () => callback(tokenId);
    }, [callback]);
    return null;
  };
  const { unmount } = await renderIntoDocument(<Harness />);
  return { invoke: () => returnToken(), pushToast, setCashuIsBusy, unmount };
};

it("blocks duplicate returns, passes the selected token and releases the wallet afterwards", async () => {
  let finish = () => {};
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const reclaim = vi.fn<CashuTransferLifecycle["reclaim"]>(async () => {
    await gate;
    return report;
  });
  const { invoke, pushToast, setCashuIsBusy, unmount } = await mount(reclaim);
  const first = invoke();
  await invoke();
  expect(reclaim).toHaveBeenCalledExactlyOnceWith(tokenId);
  expect(setCashuIsBusy).toHaveBeenLastCalledWith(true);
  finish();
  await act(async () => first);
  expect(setCashuIsBusy).toHaveBeenLastCalledWith(false);
  expect(pushToast).toHaveBeenCalledWith("cashuReclaimDone");
  await unmount();
});

describe("return outcomes", () => {
  it.each([
    [
      new ReclaimReport({
        ...report,
        unresolvedProofs: [ProofId.make("pending")],
      }),
      "cashuReclaimIncomplete",
    ],
    [
      new ReclaimReport({
        ...report,
        reclaimedAmount: NonNegativeAmount.make(0),
        reclaimedProofs: [],
        spentProofs: [ProofId.make("claimed")],
      }),
      "cashuTokenClaimed",
    ],
  ])(
    "reports an incomplete or already claimed token",
    async (result, message) => {
      const { invoke, pushToast, unmount } = await mount(async () => result);
      await act(async () => invoke());
      expect(pushToast).toHaveBeenCalledWith(message);
      await unmount();
    },
  );

  it("releases busy state after failure so a later return can be retried", async () => {
    const reclaim = vi
      .fn<CashuTransferLifecycle["reclaim"]>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(report);
    const { invoke, pushToast, setCashuIsBusy, unmount } = await mount(reclaim);
    await act(async () => invoke());
    expect(pushToast).toHaveBeenCalledWith("errorPrefix: Error: offline");
    expect(setCashuIsBusy).toHaveBeenLastCalledWith(false);
    await act(async () => invoke());
    expect(pushToast).toHaveBeenLastCalledWith("cashuReclaimDone");
    await unmount();
  });
});
