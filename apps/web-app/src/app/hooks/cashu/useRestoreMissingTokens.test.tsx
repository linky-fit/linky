import type { RestoreProgress } from "@linky/linkshu";
import {
  MintUrl,
  NonNegativeAmount,
  ReclaimReport,
  RestoreReport,
  ProofId,
} from "@linky/linkshu";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRestoreMissingTokens } from "./useRestoreMissingTokens";
import type {
  ReclaimCashuTokens,
  RestoreCashuTokens,
} from "../composition/useLinkshuComposition";
import { MAIN_MINT_URL } from "../../../utils/mint";

type RestoreMissingTokens = (
  mode?: "missing" | "reclaim" | "all",
) => Promise<void>;

interface HookOverrides {
  setTokensRestoreProgress?: (progress: RestoreProgress | null) => void;
  walletMints?: readonly string[];
  isMintDeleted?: (mintUrl: string) => boolean;
  restoreCashuTokens?: RestoreCashuTokens | null;
  pushToast?: (message: string) => void;
  reclaimCashuTokens?: ReclaimCashuTokens;
}

const emptyReport = new RestoreReport({
  restoredAmount: NonNegativeAmount.make(0),
  restoredProofs: 0,
  scannedMints: [],
  unavailableMints: [],
});

const emptyReclaim = new ReclaimReport({
  reclaimedAmount: NonNegativeAmount.make(0),
  reclaimedProofs: [],
  spentProofs: [],
  unresolvedProofs: [],
});
const emptyResult = { restore: emptyReport, reclaim: emptyReclaim };

const renderRestore = (overrides: HookOverrides): RestoreMissingTokens => {
  const restoreRef: { current: RestoreMissingTokens } = {
    current: () => Promise.resolve(),
  };
  const Harness: React.FC = () => {
    const restore = useRestoreMissingTokens({
      cashuIsBusy: false,
      walletMints: overrides.walletMints ?? [],
      defaultMintUrl: null,
      enqueueCashuOp: (op) => op(),
      isMintDeleted: overrides.isMintDeleted ?? (() => false),
      logPaymentEvent: () => {},
      mintInfoDeduped: [],
      pushToast: overrides.pushToast ?? (() => {}),
      readSeenMintsFromStorage: () => [],
      rememberSeenMint: () => {},
      reclaimCashuTokens: overrides.reclaimCashuTokens ?? null,
      restoreCashuTokens:
        overrides.restoreCashuTokens === undefined
          ? null
          : overrides.restoreCashuTokens,
      setCashuIsBusy: () => {},
      setTokensRestoreIsBusy: () => {},
      setTokensRestoreProgress:
        overrides.setTokensRestoreProgress ?? (() => {}),
      t: (key) => key,
      tokensRestoreIsBusy: false,
    });
    React.useEffect(() => {
      restoreRef.current = restore;
    }, [restore]);
    return null;
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Harness />);
  });
  return (mode) => restoreRef.current(mode);
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useRestoreMissingTokens", () => {
  it.each([false, true])(
    "forwards scan progress and clears it after recovery settles, failure: %s",
    async (fail) => {
      const setTokensRestoreProgress = vi.fn();
      const update: RestoreProgress = {
        phase: "scanning",
        completedKeysets: 2,
        totalKeysets: 5,
        totalMints: 2,
      };
      const restore = renderRestore({
        setTokensRestoreProgress,
        restoreCashuTokens: async (_mints, onProgress) => {
          onProgress?.(update);
          expect(setTokensRestoreProgress).toHaveBeenLastCalledWith(update);
          if (fail) throw new Error("recovery interrupted");
          onProgress?.({ ...update, phase: "refreshing", completedKeysets: 5 });
          return emptyResult;
        },
      });
      await act(() => restore());
      expect(setTokensRestoreProgress).toHaveBeenLastCalledWith(null);
    },
  );

  it("scans every wallet mint plus the main mint", async () => {
    const restoreCashuTokens = vi.fn<RestoreCashuTokens>(() =>
      Promise.resolve(emptyResult),
    );

    const restore = renderRestore({
      walletMints: ["https://mint-a.example", "https://mint-b.example/"],
      restoreCashuTokens,
    });
    await act(() => restore());

    expect(restoreCashuTokens).toHaveBeenCalledTimes(1);
    expect(restoreCashuTokens.mock.calls[0][0]).toEqual([
      "https://mint-a.example",
      "https://mint-b.example",
      MintUrl.make(MAIN_MINT_URL),
    ]);
  });

  it("skips deleted mints but never the always-included main mint", async () => {
    const restoreCashuTokens = vi.fn<RestoreCashuTokens>(() =>
      Promise.resolve(emptyResult),
    );

    const restore = renderRestore({
      walletMints: ["https://mint-a.example"],
      isMintDeleted: () => true,
      restoreCashuTokens,
    });
    await act(() => restore());

    expect(restoreCashuTokens.mock.calls[0][0]).toEqual([
      MintUrl.make(MAIN_MINT_URL),
    ]);
  });

  it("reports a missing runtime as a missing seed and does not scan", async () => {
    const pushToast = vi.fn();
    const restore = renderRestore({ restoreCashuTokens: null, pushToast });

    await act(() => restore());

    expect(pushToast).toHaveBeenCalledWith("seedMissing");
  });
});

describe("bulk recovery actions", () => {
  const reclaimed = new ReclaimReport({
    reclaimedAmount: NonNegativeAmount.make(12),
    reclaimedProofs: [ProofId.make("p1")],
    spentProofs: [],
    unresolvedProofs: [],
  });

  it("reclaims without scanning, and gives the full action the restore mint candidates", async () => {
    const reclaimCashuTokens = vi.fn<ReclaimCashuTokens>(async () => ({
      restore: null,
      reclaim: reclaimed,
    }));
    const restoreCashuTokens = vi.fn<RestoreCashuTokens>(
      async () => emptyResult,
    );
    const recover = renderRestore({
      reclaimCashuTokens,
      restoreCashuTokens,
      walletMints: ["https://mint-a.example"],
    });
    await act(() => recover("reclaim"));
    expect(reclaimCashuTokens).toHaveBeenLastCalledWith(undefined);
    await act(() => recover("all"));
    expect(reclaimCashuTokens).toHaveBeenLastCalledWith([
      "https://mint-a.example",
      MAIN_MINT_URL,
    ]);
    expect(restoreCashuTokens).not.toHaveBeenCalled();
  });

  it("reports incomplete recovery and blocks duplicate clicks until completion", async () => {
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const reclaimCashuTokens = vi.fn<ReclaimCashuTokens>(async () => {
      await gate;
      return {
        restore: null,
        reclaim: new ReclaimReport({
          ...reclaimed,
          unresolvedProofs: [ProofId.make("p2")],
        }),
      };
    });
    const pushToast = vi.fn();
    const recover = renderRestore({
      reclaimCashuTokens,
      restoreCashuTokens: async () => emptyResult,
      pushToast,
    });
    const first = recover("all");
    await recover("reclaim");
    expect(reclaimCashuTokens).toHaveBeenCalledTimes(1);
    finish?.();
    await act(() => first);
    expect(pushToast).toHaveBeenCalledWith("cashuReclaimIncomplete");
    await act(() => recover("reclaim"));
    expect(reclaimCashuTokens).toHaveBeenCalledTimes(2);
  });

  it("does not report nothing found when a mint could not be scanned", async () => {
    const pushToast = vi.fn();
    const recover = renderRestore({
      pushToast,
      restoreCashuTokens: async () => ({
        restore: new RestoreReport({
          ...emptyReport,
          unavailableMints: [MintUrl.make(MAIN_MINT_URL)],
        }),
        reclaim: emptyReclaim,
      }),
    });
    await act(() => recover());
    expect(pushToast).toHaveBeenCalledWith("cashuMissingRestoreIncomplete");
    expect(pushToast).not.toHaveBeenCalledWith("restoreNothing");
  });
});
