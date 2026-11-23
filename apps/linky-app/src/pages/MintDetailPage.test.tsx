import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localOverlayDismissStackAtom } from "../app/state/shell/overlays";
import { createStoredProofFixture } from "../testUtils/cashuInventory";
import {
  createMintSettings,
  type MintSettings,
} from "../testUtils/mintSettings";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { MintDetailPage } from "./MintDetailPage";

let mintSettings: MintSettings;

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock(),
);

vi.mock("../app/hooks/mint/useMintInfo", async () =>
  (await import("../testUtils/mintSettings")).mintSettingsMocks.mintInfo(
    () => mintSettings,
  ),
);

vi.mock("../app/hooks/useAllowTestMints", async () =>
  (await import("../testUtils/mintSettings")).mintSettingsMocks.allowTestMints(
    () => mintSettings,
  ),
);

vi.mock("../app/hooks/wallet/useDefaultMint", async () =>
  (await import("../testUtils/mintSettings")).mintSettingsMocks.defaultMint(
    () => mintSettings,
  ),
);

vi.mock("../app/hooks/wallet/useNpubCash", async () =>
  (await import("../testUtils/mintSettings")).mintSettingsMocks.npubCash(
    () => mintSettings,
  ),
);

vi.mock("../app/hooks/wallet/useWalletInventory", async () =>
  (await import("../testUtils/mintSettings")).mintSettingsMocks.walletInventory(
    () => mintSettings,
  ),
);

vi.mock("../app/hooks/wallet/useWalletOps", async () =>
  (await import("../testUtils/mintSettings")).mintSettingsMocks.walletOps(
    () => mintSettings,
  ),
);

vi.mock("../app/hooks/mint/useMoveMintFunds", async () =>
  (await import("../testUtils/mintSettings")).mintSettingsMocks.moveMintFunds(
    () => mintSettings,
  ),
);

vi.mock("../app/hooks/wallet/useWalletTokens", async () =>
  (await import("../testUtils/mintSettings")).mintSettingsMocks.walletTokens(
    () => mintSettings,
  ),
);

vi.mock("../app/hooks/composition/useLinkshuComposition", async () =>
  (await import("../testUtils/mintSettings")).mintSettingsMocks.linkshu(
    () => mintSettings,
  ),
);

const badgeTexts = (container: HTMLElement): string[] =>
  Array.from(
    container.querySelector('[data-testid="mint-detail-badges"]')?.children ??
      [],
  ).map((badge) => badge.textContent ?? "");

describe("MintDetailPage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("names the default mint in its header with the list's badges", async () => {
    mintSettings = createMintSettings();

    const { container, unmount } = await renderIntoDocument(
      <MintDetailPage mintUrl="https://cashu.cz" />,
    );
    expect(
      container.querySelector('[data-testid="mint-detail-name"]')?.textContent,
    ).toBe("cashu.cz");
    expect(badgeTexts(container)).toEqual([
      "defaultMintBadge",
      "recommendedMintBadge",
    ]);
    expect(container.textContent).not.toContain("mintSetAsDefault");
    expect(container.querySelector('[data-testid="mint-fees"]')).not.toBeNull();
    await unmount();
  });

  it("offers to make another mint the default", async () => {
    const mintUrl = "https://mint.minibits.cash/Bitcoin";
    const applyDefaultMintSelection = vi.fn(async () => true);
    mintSettings = createMintSettings({ applyDefaultMintSelection });

    const { container, unmount } = await renderIntoDocument(
      <MintDetailPage mintUrl={mintUrl} />,
    );
    expect(
      container.querySelector('[data-testid="mint-detail-name"]')?.textContent,
    ).toBe("mint.minibits.cash/Bitcoin");
    expect(badgeTexts(container)).toEqual([]);

    const setDefault = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "mintSetAsDefault",
    );
    if (!setDefault) throw new Error("set-as-default button missing");
    await act(async () => {
      setDefault.click();
    });
    expect(applyDefaultMintSelection).toHaveBeenCalledWith(mintUrl);
    await unmount();
  });

  it("opens the move-funds keypad inside a sheet and dismisses it on Android back", async () => {
    const registry = AtomRegistry.make();
    mintSettings = createMintSettings({
      cashuProofs: [
        createStoredProofFixture({ mint: "https://cashu.cz", amount: 50 }),
      ],
    });

    const { container, unmount } = await renderIntoDocument(
      <RegistryContext.Provider value={registry}>
        <MintDetailPage mintUrl="https://cashu.cz" />
      </RegistryContext.Provider>,
    );
    expect(document.querySelector('[data-testid="mint-move-form"]')).toBeNull();

    const openMove = container.querySelector<HTMLButtonElement>(
      '[data-testid="mint-move-open"]',
    );
    if (!openMove) throw new Error("move funds button missing");
    await act(async () => {
      openMove.click();
    });
    expect(
      document.querySelector('[role="dialog"] [data-testid="mint-move-form"]'),
    ).not.toBeNull();
    const dismiss = registry.get(localOverlayDismissStackAtom).at(-1)?.dismiss;
    expect(dismiss).toBeDefined();

    await act(async () => {
      dismiss?.();
    });
    expect(registry.get(localOverlayDismissStackAtom)).toHaveLength(0);
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(document.querySelector('[data-testid="mint-move-form"]')).toBeNull();
    await unmount();
  });
});
