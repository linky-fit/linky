import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MintSettingsContextValue } from "../app/context/SystemSettingsContexts";
import { createMintSettings } from "../testUtils/mintSettings";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { MintsPage } from "./MintsPage";

let mintSettings: MintSettingsContextValue;

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("../hooks/useRouting", () => ({
  navigateTo: mockNavigate,
}));

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({
    formatDisplayedAmountText: (amount: number) => `${amount} sat`,
    t: (key: string) => key,
  }),
}));

vi.mock("../app/context/SystemSettingsContexts", () => ({
  useMintSettingsContext: () => mintSettings,
}));

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

    expect(
      container.querySelector(".mint-choice-badge.is-recommended"),
    ).not.toBeNull();
    expect(
      findButton(container, "cashu.cz").classList.contains("is-selected"),
    ).toBe(true);
    const selectedItem = container.querySelector(
      ".mint-choice-item.is-selected",
    );
    expect(selectedItem?.textContent).toContain("cashu.cz");
    expect(selectedItem?.querySelector(".mint-fees")).not.toBeNull();
    expect(container.querySelectorAll(".mint-fees")).toHaveLength(1);

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
    expect(container.querySelector(".mint-choice-test-group")).toBeNull();
    await unmount();
  });

  it("shows the test group while test mints are allowed", async () => {
    mintSettings = createMintSettings();
    const { container, unmount } = await renderIntoDocument(<MintsPage />);
    expect(container.textContent).toContain("testnut.cashu.space");
    await unmount();
  });
});
