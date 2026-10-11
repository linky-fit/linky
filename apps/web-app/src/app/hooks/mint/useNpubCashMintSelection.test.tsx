import React, { act } from "react";
import { nip19 } from "nostr-tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type { WriteOutcome } from "../../lib/storeWrite";
import { useNpubCashMintSelection } from "./useNpubCashMintSelection";

interface SelectionHarnessProps {
  applyRef: React.RefObject<((mintUrl: string) => Promise<boolean>) | null>;
  defaultMintUrl: string;
  pushToast: (message: string) => void;
  setDefaultMint: (mint: string) => Promise<WriteOutcome>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
}

const validNsec = nip19.nsecEncode(
  Uint8Array.from({ length: 32 }, (_, index) => index + 1),
);

const SelectionHarness = ({
  applyRef,
  defaultMintUrl,
  pushToast,
  setDefaultMint,
  setStatus,
}: SelectionHarnessProps): null => {
  const npubCashMintSyncRef = React.useRef<string | null>(null);
  const { applyDefaultMintSelection } = useNpubCashMintSelection({
    currentNpub: "npub-test",
    currentNsec: validNsec,
    defaultMintChoice: React.useMemo(
      () => ({ mint: defaultMintUrl, chosen: false }),
      [defaultMintUrl],
    ),
    npubCashMintSyncRef,
    pushToast,
    setDefaultMint,
    setStatus,
    t: (key) => key,
  });
  React.useEffect(() => {
    applyRef.current = applyDefaultMintSelection;
  }, [applyDefaultMintSelection, applyRef]);
  return null;
};

const readApplyMintSelection = (
  applyRef: React.RefObject<((mintUrl: string) => Promise<boolean>) | null>,
): ((mintUrl: string) => Promise<boolean>) => {
  if (applyRef.current === null) {
    throw new Error("mint selection callback missing");
  }
  return applyRef.current;
};

interface RenderSelectionHarnessOptions {
  defaultMintUrl?: string;
}

const renderSelectionHarness = async ({
  defaultMintUrl = "https://cashu.cz",
}: RenderSelectionHarnessOptions = {}) => {
  const pushToast = vi.fn();
  const setDefaultMint = vi.fn<(mint: string) => Promise<WriteOutcome>>(
    async () => ({ ok: true }),
  );
  const setStatus =
    vi.fn<React.Dispatch<React.SetStateAction<string | null>>>();
  const applyRef = React.createRef<
    ((mintUrl: string) => Promise<boolean>) | null
  >();

  const { root } = await renderIntoDocument(
    <SelectionHarness
      applyRef={applyRef}
      defaultMintUrl={defaultMintUrl}
      pushToast={pushToast}
      setDefaultMint={setDefaultMint}
      setStatus={setStatus}
    />,
  );

  return {
    applyRef,
    pushToast,
    root,
    setDefaultMint,
    setStatus,
  };
};

describe("useNpubCashMintSelection", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("does not persist a mint when hosted mint sync fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const harness = await renderSelectionHarness();

    await act(async () => {
      await readApplyMintSelection(harness.applyRef)("https://kashu.me");
    });

    expect(harness.setDefaultMint).not.toHaveBeenCalled();
    expect(harness.pushToast).toHaveBeenCalledWith("mintUpdateFailed");

    await act(async () => {
      harness.root.unmount();
    });
  });

  it("saves the synced mint without touching the existing balance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const harness = await renderSelectionHarness();

    await act(async () => {
      await readApplyMintSelection(harness.applyRef)("https://kashu.me");
    });

    expect(harness.setDefaultMint).toHaveBeenCalledWith("https://kashu.me");
    expect(harness.setStatus).toHaveBeenLastCalledWith("mintSaved");

    await act(async () => {
      harness.root.unmount();
    });
  });
});
