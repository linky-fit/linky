import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStoredProofFixture,
  createTransferFixture,
} from "../testUtils/cashuInventory";
import {
  createMintSettings,
  type MintSettings,
} from "../testUtils/mintSettings";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { MintsPage } from "./MintsPage";

let mintSettings: MintSettings;

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("../hooks/useRouting", () => ({
  navigateTo: mockNavigate,
}));

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

vi.mock("../app/hooks/wallet/useWalletInventory", async () =>
  (await import("../testUtils/mintSettings")).mintSettingsMocks.walletInventory(
    () => mintSettings,
  ),
);

vi.mock("../app/hooks/composition/useLinkshuComposition", async () =>
  (await import("../testUtils/mintSettings")).mintSettingsMocks.linkshu(
    () => mintSettings,
  ),
);

const findButton = (
  container: HTMLElement,
  text: string,
): HTMLButtonElement => {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(text),
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`button missing: ${text}`);
  }
  return button;
};

const click = (button: HTMLButtonElement): void => {
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

describe("MintsPage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("opens a mint's detail page and marks the default", async () => {
    mintSettings = createMintSettings();

    const { container, unmount } = await renderIntoDocument(<MintsPage />);

    await act(async () => {
      click(findButton(container, "kashu.me"));
    });
    expect(mockNavigate).toHaveBeenCalledWith({
      route: "mint",
      mintUrl: "https://kashu.me",
    });

    const selectedButton = findButton(container, "cashu.cz");
    expect(selectedButton.textContent).toContain("recommendedMintBadge");
    expect(selectedButton.getAttribute("aria-selected")).toBe("true");
    const selectedItem = selectedButton.closest('[data-testid="mint-choice"]');
    expect(
      selectedItem?.querySelector('[data-testid="mint-fees"]'),
    ).not.toBeNull();
    expect(
      container.querySelectorAll('[data-testid="mint-fees"]'),
    ).toHaveLength(1);

    await unmount();
  });

  it("shows each funded mint's balance with its share of the total", async () => {
    mintSettings = createMintSettings({
      cashuProofs: [
        createStoredProofFixture({
          id: "a",
          mint: "https://cashu.cz",
          amount: 64,
        }),
        createStoredProofFixture({
          id: "b",
          mint: "https://cashu.cz",
          amount: 11,
        }),
        createStoredProofFixture({
          id: "c",
          mint: "https://kashu.me",
          amount: 25,
        }),
        createStoredProofFixture({
          id: "d",
          mint: "https://kashu.me",
          amount: 100,
          state: "spent",
        }),
      ],
    });

    const { container, unmount } = await renderIntoDocument(<MintsPage />);
    const holdings = Array.from(
      container.querySelectorAll('[data-testid="mint-holding"]'),
    ).map((holding) => ({
      text: holding.textContent,
      share: holding
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow"),
    }));
    expect(holdings).toEqual([
      { text: "75 sat", share: "75" },
      { text: "25 sat", share: "25" },
    ]);
    await unmount();
  });

  it("lists a token waiting for its mint as pending, apart from the balance", async () => {
    mintSettings = createMintSettings({
      cashuProofs: [
        createStoredProofFixture({ mint: "https://cashu.cz", amount: 40 }),
      ],
      cashuDeferredReceives: [
        createTransferFixture({
          kind: "deferredReceive",
          status: "pending",
          mint: "https://cashu.cz",
          amount: 21,
        }),
        createTransferFixture({
          id: "AgICAgICAgICAgICAgICAg",
          kind: "deferredReceive",
          status: "pending",
          mint: "https://offline.example",
          amount: 5,
        }),
      ],
    });

    const { container, unmount } = await renderIntoDocument(<MintsPage />);
    const holdingOf = (mint: string) =>
      Array.from(container.querySelectorAll('[data-testid="mint-choice"]'))
        .find((item) => item.textContent?.includes(mint))
        ?.querySelector('[data-testid="mint-holding"]');

    const funded = holdingOf("cashu.cz");
    expect(funded?.textContent).toContain("40 sat");
    expect(
      funded?.querySelector('[data-testid="mint-pending"]')?.textContent,
    ).toBe("mintPendingAmount");
    const offline = holdingOf("offline.example");
    expect(offline?.querySelector('[role="progressbar"]')).toBeNull();
    expect(
      offline?.querySelector('[data-testid="mint-pending"]'),
    ).not.toBeNull();
    await unmount();
  });

  it("opens the add-mint page from the add button", async () => {
    mintSettings = createMintSettings();

    const { container, unmount } = await renderIntoDocument(<MintsPage />);
    const addButton = container.querySelector('button[aria-label="mintAdd"]');
    if (!(addButton instanceof HTMLButtonElement)) {
      throw new Error("add mint button missing");
    }

    await act(async () => {
      click(addButton);
    });
    expect(mockNavigate).toHaveBeenCalledWith({ route: "mintNew" });

    await unmount();
  });

  it("hides test mints while they are off", async () => {
    mintSettings = createMintSettings({ allowTestMints: false });

    const { container, unmount } = await renderIntoDocument(<MintsPage />);
    expect(container.textContent).not.toContain("testnut.cashu.space");
    expect(
      container.querySelector('[data-testid="mint-test-group"]'),
    ).toBeNull();
    await unmount();
  });

  it("shows the test group while test mints are allowed", async () => {
    mintSettings = createMintSettings();
    const { container, unmount } = await renderIntoDocument(<MintsPage />);
    expect(container.textContent).toContain("testnut.cashu.space");
    await unmount();
  });
});
