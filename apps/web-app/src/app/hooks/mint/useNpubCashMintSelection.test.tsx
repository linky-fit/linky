import React, { act } from "react";
import { nip19 } from "nostr-tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { CASHU_DEFAULT_MINT_OVERRIDE_STORAGE_KEY } from "../../../utils/mint";
import { useNpubCashMintSelection } from "./useNpubCashMintSelection";

interface SelectionHarnessProps {
  applyRef: React.RefObject<((mintUrl: string) => Promise<void>) | null>;
  defaultMintUrl: string;
  makeLocalStorageKey: (prefix: string) => string;
  pushToast: (message: string) => void;
  setDefaultMintUrl: React.Dispatch<React.SetStateAction<string | null>>;
  setDefaultMintUrlDraft: React.Dispatch<React.SetStateAction<string>>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
}

const validNsec = nip19.nsecEncode(
  Uint8Array.from({ length: 32 }, (_, index) => index + 1),
);

const SelectionHarness = ({
  applyRef,
  defaultMintUrl,
  makeLocalStorageKey,
  pushToast,
  setDefaultMintUrl,
  setDefaultMintUrlDraft,
  setStatus,
}: SelectionHarnessProps): null => {
  const hasMintOverrideRef = React.useRef(false);
  const npubCashMintSyncRef = React.useRef<string | null>(null);
  const { applyDefaultMintSelection } = useNpubCashMintSelection({
    currentNpub: "npub-test",
    currentNsec: validNsec,
    defaultMintUrl,
    defaultMintUrlDraft: defaultMintUrl,
    hasMintOverrideRef,
    makeLocalStorageKey,
    npubCashMintSyncRef,
    pushToast,
    setDefaultMintUrl,
    setDefaultMintUrlDraft,
    setStatus,
    t: (key) => key,
  });
  React.useEffect(() => {
    applyRef.current = applyDefaultMintSelection;
  }, [applyDefaultMintSelection, applyRef]);
  return null;
};

const readApplyMintSelection = (
  applyRef: React.RefObject<((mintUrl: string) => Promise<void>) | null>,
): ((mintUrl: string) => Promise<void>) => {
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
  const setDefaultMintUrl =
    vi.fn<React.Dispatch<React.SetStateAction<string | null>>>();
  const setDefaultMintUrlDraft =
    vi.fn<React.Dispatch<React.SetStateAction<string>>>();
  const setStatus =
    vi.fn<React.Dispatch<React.SetStateAction<string | null>>>();
  const makeLocalStorageKey = (prefix: string): string => `${prefix}.owner`;
  const applyRef = React.createRef<
    ((mintUrl: string) => Promise<void>) | null
  >();

  const { root } = await renderIntoDocument(
    <SelectionHarness
      applyRef={applyRef}
      defaultMintUrl={defaultMintUrl}
      makeLocalStorageKey={makeLocalStorageKey}
      pushToast={pushToast}
      setDefaultMintUrl={setDefaultMintUrl}
      setDefaultMintUrlDraft={setDefaultMintUrlDraft}
      setStatus={setStatus}
    />,
  );

  return {
    applyRef,
    makeLocalStorageKey,
    pushToast,
    root,
    setDefaultMintUrl,
    setDefaultMintUrlDraft,
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

    expect(
      localStorage.getItem(
        harness.makeLocalStorageKey(CASHU_DEFAULT_MINT_OVERRIDE_STORAGE_KEY),
      ),
    ).toBeNull();
    expect(harness.setDefaultMintUrl).not.toHaveBeenCalled();
    expect(harness.setDefaultMintUrlDraft).not.toHaveBeenCalled();
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

    expect(
      localStorage.getItem(
        harness.makeLocalStorageKey(CASHU_DEFAULT_MINT_OVERRIDE_STORAGE_KEY),
      ),
    ).toBe("https://kashu.me");
    expect(harness.setDefaultMintUrl).toHaveBeenCalledWith("https://kashu.me");
    expect(harness.setDefaultMintUrlDraft).toHaveBeenCalledWith(
      "https://kashu.me",
    );
    expect(harness.setStatus).toHaveBeenLastCalledWith("mintSaved");

    await act(async () => {
      harness.root.unmount();
    });
  });
});
