import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import { nip19 } from "nostr-tools";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSecretKey } from "../../../testUtils/nostrKeys";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type { WriteOutcome } from "../../lib/storeWrite";
import { useNpubCash } from "./useNpubCash";

vi.mock("../../state/wallet/npubCash", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../state/wallet/npubCash")>();
  const { AsyncResult, Atom } = await import("effect/reactivity");
  return {
    ...actual,
    npubCashCommandsAtom: Atom.make(AsyncResult.initial()),
  };
});

const validNsec = nip19.nsecEncode(createSecretKey(1));

const renderSelection = async () => {
  const pushToast = vi.fn();
  const setStatus =
    vi.fn<React.Dispatch<React.SetStateAction<string | null>>>();
  const setDefaultMint = vi.fn<(mint: string) => Promise<WriteOutcome>>(
    async () => ({ ok: true }),
  );
  const hook: { apply: ((mint: string) => Promise<boolean>) | null } = {
    apply: null,
  };
  const Probe = () => {
    const { applyDefaultMintSelection } = useNpubCash({
      copyText: async () => {},
      currentNpub: "npub-test",
      currentNsec: validNsec,
      defaultMintChoice: { mint: "https://cashu.cz", chosen: false },
      formatDisplayedAmountParts: (amount) => ({
        approxPrefix: "",
        amountText: String(amount),
        unitLabel: "sat",
      }),
      isMintDeleted: () => false,
      maybeShowPwaNotification: async () => {},
      mintInfoByUrl: new Map(),
      networkEnabled: false,
      npubCashInfoInFlightRef: React.useRef(false),
      npubCashInfoLoadedAtMsRef: React.useRef(0),
      npubCashInfoLoadedForNpubRef: React.useRef<string | null>(null),
      pushToast,
      refreshMintInfo: () => {},
      rememberCashuTokenKnown: () => {},
      routeKind: "wallet",
      setDefaultMint,
      setIsProfileEditing: () => {},
      setOwnedProfileLightningAddresses: () => {},
      setOwnedProfileLightningAddressesLoading: () => {},
      setStatus,
      showPaidOverlay: () => {},
      suggestDefaultMint: () => {},
      t: (key) => key,
      touchMintInfo: () => {},
    });
    React.useEffect(() => {
      hook.apply = applyDefaultMintSelection;
    }, [applyDefaultMintSelection]);
    return null;
  };
  const view = await renderIntoDocument(
    <RegistryContext.Provider value={AtomRegistry.make()}>
      <Probe />
    </RegistryContext.Provider>,
  );
  const apply = (mint: string) =>
    act(async () => {
      await hook.apply?.(mint);
    });
  return { apply, pushToast, setDefaultMint, setStatus, view };
};

describe("useNpubCash", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not store a mint npub.cash refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const ui = await renderSelection();

    await ui.apply("https://kashu.me");

    expect(ui.setDefaultMint).not.toHaveBeenCalled();
    expect(ui.pushToast).toHaveBeenCalledWith("mintUpdateFailed");
    await ui.view.unmount();
  });

  it("stores the mint npub.cash accepted, without touching the balance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const ui = await renderSelection();

    await ui.apply("https://kashu.me");

    expect(ui.setDefaultMint).toHaveBeenCalledWith("https://kashu.me");
    expect(ui.setStatus).toHaveBeenLastCalledWith("mintSaved");
    await ui.view.unmount();
  });

  it("refuses a mint that is not a url", async () => {
    const ui = await renderSelection();

    await ui.apply("not a mint");

    expect(ui.pushToast).toHaveBeenCalledWith("mintUrlInvalid");
    expect(ui.setDefaultMint).not.toHaveBeenCalled();
    await ui.view.unmount();
  });
});
