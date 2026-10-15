import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
});
