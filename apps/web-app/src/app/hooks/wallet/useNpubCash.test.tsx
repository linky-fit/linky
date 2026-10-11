import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import { nip19 } from "nostr-tools";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signedInSession } from "../../../testUtils/appRegistry";
import { createSecretKey } from "../../../testUtils/nostrKeys";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type { WriteOutcome } from "../../lib/storeWrite";
import { sessionAtom } from "../../state/session/session";
import { useApplyDefaultMint } from "./useNpubCash";

const { pushToast, setDefaultMint, setStatus } = vi.hoisted(() => ({
  pushToast: vi.fn(),
  setDefaultMint: vi.fn<(mint: string) => Promise<WriteOutcome>>(),
  setStatus: vi.fn(),
}));

vi.mock("../shell", async () =>
  (await import("../../../testUtils/shellHooks")).shellHooksMock({
    pushToast: (message) => pushToast(message),
    setStatus: (message) => setStatus(message),
  }),
);

vi.mock("../../state/wallet/defaultMint", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../state/wallet/defaultMint")>();
  const { AsyncResult, Atom } = await import("effect/reactivity");
  return {
    ...actual,
    defaultMintCommandsAtom: Atom.make(
      AsyncResult.success({
        setDefaultMint: (mint: string) => setDefaultMint(mint),
      }),
    ),
  };
});

const validNsec = nip19.nsecEncode(createSecretKey(1));

const renderSelection = async () => {
  setDefaultMint.mockImplementation(async () => ({ ok: true }));
  const hook: { apply: ((mint: string) => Promise<boolean>) | null } = {
    apply: null,
  };
  const Probe = () => {
    const applyDefaultMintSelection = useApplyDefaultMint();
    React.useEffect(() => {
      hook.apply = applyDefaultMintSelection;
    }, [applyDefaultMintSelection]);
    return null;
  };
  const registry = AtomRegistry.make({
    initialValues: [[sessionAtom, signedInSession({ nsec: validNsec })]],
  });
  const view = await renderIntoDocument(
    <RegistryContext.Provider value={registry}>
      <Probe />
    </RegistryContext.Provider>,
  );
  const apply = (mint: string) =>
    act(async () => {
      await hook.apply?.(mint);
    });
  return { apply, view };
};

describe("useApplyDefaultMint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("does not store a mint npub.cash refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const ui = await renderSelection();

    await ui.apply("https://kashu.me");

    expect(setDefaultMint).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith("mintUpdateFailed");
    await ui.view.unmount();
  });

  it("stores the mint npub.cash accepted, without touching the balance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const ui = await renderSelection();

    await ui.apply("https://kashu.me");

    expect(setDefaultMint).toHaveBeenCalledWith("https://kashu.me");
    expect(setStatus).toHaveBeenLastCalledWith("mintSaved");
    await ui.view.unmount();
  });

  it("refuses a mint that is not a url", async () => {
    const ui = await renderSelection();

    await ui.apply("not a mint");

    expect(pushToast).toHaveBeenCalledWith("mintUrlInvalid");
    expect(setDefaultMint).not.toHaveBeenCalled();
    await ui.view.unmount();
  });
});
