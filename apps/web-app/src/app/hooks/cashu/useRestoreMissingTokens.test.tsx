import { MintUrl, NonNegativeAmount, RestoreReport } from "@linky/linkshu";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRestoreMissingTokens } from "./useRestoreMissingTokens";
import type { RestoreCashuTokens } from "../composition/useLinkshuComposition";
import type { CashuTokenRow } from "../../../evolu";
import { createCashuTokenRowFixture } from "../../../testUtils/cashuTokenRow";
import { MAIN_MINT_URL } from "../../../utils/mint";

type RestoreMissingTokens = () => Promise<void>;

interface HookOverrides {
  cashuTokensAll?: readonly CashuTokenRow[];
  isMintDeleted?: (mintUrl: string) => boolean;
  restoreCashuTokens?: RestoreCashuTokens | null;
  pushToast?: (message: string) => void;
}

const rowWithMint = (mint: string, isDeleted = false): CashuTokenRow =>
  createCashuTokenRowFixture({ mint, isDeleted });

const emptyReport = new RestoreReport({
  restoredAmount: NonNegativeAmount.make(0),
  rows: [],
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
      cashuTokensAll: overrides.cashuTokensAll ?? [],
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
  it("scans stored-row mints (including soft-deleted rows) plus the main mint", async () => {
    const restoreCashuTokens = vi.fn<RestoreCashuTokens>(() =>
      Promise.resolve(emptyReport),
    );

    const restore = renderRestore({
      cashuTokensAll: [
        rowWithMint("https://mint-a.example"),
        rowWithMint("https://mint-b.example/", true),
      ],
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
      cashuTokensAll: [rowWithMint("https://mint-a.example")],
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
