import { MintUrl, NonNegativeAmount, RestoreReport } from "@linky/linkshu";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRestoreMissingTokens } from "./useRestoreMissingTokens";
import type { RestoreCashuTokens } from "../composition/useLinkshuComposition";
import { MAIN_MINT_URL } from "../../../utils/mint";

type RestoreMissingTokens = () => Promise<void>;

interface HookOverrides {
  walletMints?: readonly string[];
  isMintDeleted?: (mintUrl: string) => boolean;
  restoreCashuTokens?: RestoreCashuTokens | null;
  pushToast?: (message: string) => void;
}

const emptyReport = new RestoreReport({
  restoredAmount: NonNegativeAmount.make(0),
  restoredProofs: 0,
  scannedMints: [],
  unavailableMints: [],
});

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
      restoreCashuTokens:
        overrides.restoreCashuTokens === undefined
          ? null
          : overrides.restoreCashuTokens,
      setCashuIsBusy: () => {},
      setTokensRestoreIsBusy: () => {},
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
  return () => restoreRef.current();
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useRestoreMissingTokens", () => {
  it("scans every wallet mint plus the main mint", async () => {
    const restoreCashuTokens = vi.fn<RestoreCashuTokens>(() =>
      Promise.resolve(emptyReport),
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
      Promise.resolve(emptyReport),
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
