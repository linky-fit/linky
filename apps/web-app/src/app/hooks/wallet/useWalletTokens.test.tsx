import { CashuOperationId } from "@linky-fit/linksync";
import {
  Amount,
  CurrencyUnit,
  MintUrl,
  NonNegativeAmount,
  OperationId,
  ProofId,
  ReclaimReport,
  RestoreReport,
  SendReceipt,
  TokenText,
  type RestoreProgress,
} from "@linky-fit/linkshu";
import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import { act, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type {
  RecoverTokensOutcome,
  TokensCommands,
} from "../../state/wallet/tokens";
import {
  useTokenContactSend,
  useTokenRecovery,
  useWalletTokens,
} from "./useWalletTokens";

const { fake, navigateTo, ui } = vi.hoisted(() => {
  const fake: { current: Partial<TokensCommands> | null } = { current: null };
  return {
    fake,
    navigateTo: vi.fn(),
    ui: { pushToast: vi.fn(), setStatus: vi.fn() },
  };
});
vi.mock("../../../hooks/useRouting", () => ({ navigateTo }));
vi.mock("../shell", async () =>
  (await import("../../../testUtils/shellHooks")).shellHooksMock({
    pushToast: ui.pushToast,
    setStatus: ui.setStatus,
    t: (key) => key,
  }),
);
vi.mock("./useWalletInventory", () => ({
  useWalletBalance: () => ({ cashuBalance: 100 }),
}));
vi.mock("../../state/wallet/tokens", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../state/wallet/tokens")>();
  const { AsyncResult, Atom } = await import("effect/reactivity");
  return {
    ...actual,
    tokensCommandsAtom: Atom.readable(() =>
      fake.current === null
        ? AsyncResult.initial()
        : AsyncResult.success(fake.current),
    ),
  };
});

const reclaimed = (
  fields: Partial<ConstructorParameters<typeof ReclaimReport>[0]> = {},
) =>
  new ReclaimReport({
    reclaimedAmount: NonNegativeAmount.make(12),
    reclaimedProofs: [ProofId.make("p1")],
    spentProofs: [],
    unresolvedProofs: [],
    ...fields,
  });

const tokenId = CashuOperationId.orThrow("AQEBAQEBAQEBAQEBAQEBAQ");

const render = async () => {
  type Hooks = ReturnType<typeof useWalletTokens> &
    ReturnType<typeof useTokenRecovery> &
    ReturnType<typeof useTokenContactSend>;
  const hook: { current: Hooks | null } = { current: null };
  const Probe = () => {
    const tokens = {
      ...useWalletTokens(),
      ...useTokenRecovery({
        allowTestMints: true,
        defaultMintUrl: null,
        isMintDeleted: () => false,
        mintInfoDeduped: [],
        readSeenMints: () => [],
        recoverEnvelopes: async () => {},
        rememberSeenMint: () => {},
        walletMints: ["https://mint-a.example"],
      }),
      ...useTokenContactSend({ walletTransfers: [] }),
    };
    useEffect(() => {
      hook.current = tokens;
    });
    return null;
  };
  const view = await renderIntoDocument(
    <RegistryContext.Provider value={AtomRegistry.make()}>
      <Probe />
    </RegistryContext.Provider>,
  );
  const current = () => {
    if (hook.current === null) throw new Error("hook not rendered");
    return hook.current;
  };
  return { ...ui, current, view };
};

afterEach(() => {
  fake.current = null;
  vi.clearAllMocks();
});

describe("useWalletTokens", () => {
  it.each([
    [reclaimed(), "cashuReclaimDone"],
    [
      reclaimed({ unresolvedProofs: [ProofId.make("p2")] }),
      "cashuReclaimIncomplete",
    ],
    [
      reclaimed({ reclaimedProofs: [], spentProofs: [ProofId.make("p2")] }),
      "cashuTokenClaimed",
    ],
    [reclaimed({ reclaimedProofs: [] }), "cashuNoProofs"],
  ])("toasts a reclaim as %#", async (report, message) => {
    fake.current = {
      reclaimTransfer: vi.fn(
        async () => ({ _tag: "Reclaimed", report }) as const,
      ),
    };
    const ui = await render();

    await act(() => ui.current().reclaimCashuTransfer(tokenId));

    expect(ui.pushToast).toHaveBeenCalledWith(message);
    await ui.view.unmount();
  });

  it("blocks a duplicate reclaim until the first one finished", async () => {
    let finish = () => {};
    const reclaimTransfer = vi.fn(
      () =>
        new Promise<{
          readonly _tag: "Reclaimed";
          readonly report: ReclaimReport;
        }>((resolve) => {
          finish = () => resolve({ _tag: "Reclaimed", report: reclaimed() });
        }),
    );
    fake.current = { reclaimTransfer };
    const ui = await render();

    const first = ui.current().reclaimCashuTransfer(tokenId);
    await ui.current().reclaimCashuTransfer(tokenId);
    finish();
    await act(() => first);

    expect(reclaimTransfer).toHaveBeenCalledOnce();
    await ui.view.unmount();
  });

  it("asks for the seed while the wallet is not ready", async () => {
    const ui = await render();

    await act(() => ui.current().reclaimCashuTransfer(tokenId));
    await act(() => ui.current().restoreMissingTokens());

    expect(ui.pushToast).toHaveBeenNthCalledWith(1, "seedMissing");
    expect(ui.pushToast).toHaveBeenNthCalledWith(2, "seedMissing");
    await ui.view.unmount();
  });

  it.each<[RecoverTokensOutcome, string]>([
    [{ _tag: "NothingToScan" }, "restoreNothing"],
    [
      {
        _tag: "Restored",
        restore: new RestoreReport({
          restoredAmount: NonNegativeAmount.make(0),
          restoredProofs: 0,
          scannedMints: [],
          unavailableMints: [],
        }),
        reclaim: reclaimed({ reclaimedAmount: NonNegativeAmount.make(0) }),
        incomplete: true,
      },
      "cashuMissingRestoreIncomplete",
    ],
    [{ _tag: "Failed", detail: "boom" }, "restoreFailed: boom"],
  ])(
    "reports a recovery %o and clears its progress",
    async (outcome, message) => {
      const progress: RestoreProgress = {
        phase: "scanning",
        completedKeysets: 1,
        totalKeysets: 2,
        totalMints: 1,
      };
      const recoverTokens = vi.fn<TokensCommands["recoverTokens"]>(
        async (args, options) => {
          options?.onStarted?.();
          args.onProgress(progress);
          return outcome;
        },
      );
      fake.current = { recoverTokens };
      const ui = await render();

      await act(() => ui.current().restoreMissingTokens());

      expect(recoverTokens.mock.calls[0]?.[0].mints).toContain(
        "https://mint-a.example",
      );
      expect(ui.pushToast).toHaveBeenCalledWith(message);
      expect(ui.current().tokensRestoreProgress).toBeNull();
      expect(ui.current().tokensRestoreIsBusy).toBe(false);
      await ui.view.unmount();
    },
  );

  it("opens a freshly issued token and clears the amount", async () => {
    fake.current = {
      issueToken: vi.fn<TokensCommands["issueToken"]>(
        async (_args, options) => {
          options?.onStarted?.();
          return {
            _tag: "Issued",
            receipt: new SendReceipt({
              operationId: OperationId.make(tokenId),
              tokenText: TokenText.make("cashuBtoken"),
              proofs: [],
              mint: MintUrl.make("https://mint-a.example"),
              unit: CurrencyUnit.make("sat"),
              amount: Amount.make(21),
              lockTo: null,
              changeAmount: NonNegativeAmount.make(0),
              feePaid: NonNegativeAmount.make(0),
            }),
          };
        },
      ),
    };
    const ui = await render();
    act(() => ui.current().setCashuEmitAmount("21"));

    await act(() => ui.current().emitCashuToken({ note: "tip" }));

    expect(ui.setStatus).toHaveBeenCalledWith("cashuEmitting");
    expect(navigateTo).toHaveBeenCalledWith({
      route: "cashuToken",
      id: tokenId,
    });
    expect(ui.current().cashuEmitAmount).toBe("");
    await ui.view.unmount();
  });

  it("opens the chat once the sent token's transfer closed and tells a queued send", async () => {
    fake.current = {
      sendIssuedToken: vi.fn<TokensCommands["sendIssuedToken"]>(
        async (args) => {
          args.onClosed?.();
          return { _tag: "Queued" };
        },
      ),
    };
    const ui = await render();

    await act(() =>
      ui
        .current()
        .sendCashuTokenToContact({ id: "contact-1", npub: "npub1" }, tokenId),
    );

    expect(navigateTo).toHaveBeenCalledWith({ route: "chat", id: "contact-1" });
    expect(ui.setStatus).toHaveBeenCalledWith("chatQueued");
    await ui.view.unmount();
  });
});
