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

  it("opens a mint's detail page and saves a custom default", async () => {
    const applyDefaultMintSelection = vi.fn(async () => {});
    mintSettings = createMintSettings({ applyDefaultMintSelection });

    const { container, root } = await renderIntoDocument(<MintsPage />);

    await act(async () => {
      click(findButton(container, "kashu.me"));
    });
    expect(mockNavigate).toHaveBeenCalledWith({
      route: "mint",
      mintUrl: "https://kashu.me",
    });
    expect(applyDefaultMintSelection).not.toHaveBeenCalled();

    await act(async () => {
      click(findButton(container, "saveChanges"));
    });
    expect(applyDefaultMintSelection).toHaveBeenCalledWith(
      "https://custom.example",
    );

    mintSettings = createMintSettings({
      applyDefaultMintSelection,
      defaultMintUrlDraft: "kashu.me",
    });
    await act(async () => {
      root.render(<MintsPage />);
    });
    await act(async () => {
      click(findButton(container, "saveChanges"));
    });
    expect(applyDefaultMintSelection).toHaveBeenLastCalledWith(
      "https://kashu.me",
    );

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

    await act(async () => {
      root.unmount();
    });
  });

  it("blocks the custom save while busy", async () => {
    const applyDefaultMintSelection = vi.fn(async () => {});
    const setDefaultMintUrlDraft = vi.fn();
    mintSettings = createMintSettings({
      applyDefaultMintSelection,
      cashuIsBusy: true,
      setDefaultMintUrlDraft,
    });

    const { container, root } = await renderIntoDocument(<MintsPage />);

    const input = container.querySelector("#defaultMintUrl");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("custom mint input missing");
    }
    expect(input.disabled).toBe(true);

    const saveButton = findButton(container, "saveChanges");
    expect(saveButton.disabled).toBe(true);

    await act(async () => {
      click(saveButton);
    });
    expect(applyDefaultMintSelection).not.toHaveBeenCalled();
    expect(setDefaultMintUrlDraft).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("hides test mints and refuses a test-mint URL while they are off", async () => {
    const applyDefaultMintSelection = vi.fn(async () => {});
    const setStatus = vi.fn();
    mintSettings = createMintSettings({
      allowTestMints: false,
      applyDefaultMintSelection,
      defaultMintUrlDraft: "https://testnut.cashu.space",
      setStatus,
    });

    const { container, unmount } = await renderIntoDocument(<MintsPage />);
    expect(container.textContent).not.toContain("testnut.cashu.space");
    expect(container.querySelector(".mint-choice-test-group")).toBeNull();

    await act(async () => {
      click(findButton(container, "saveChanges"));
    });
    expect(setStatus).toHaveBeenCalledWith("mintTestMintNotAllowed");
    expect(applyDefaultMintSelection).not.toHaveBeenCalled();
    await unmount();
  });

  it("shows the test group while test mints are allowed", async () => {
    mintSettings = createMintSettings();
    const { container, unmount } = await renderIntoDocument(<MintsPage />);
    expect(container.textContent).toContain("testnut.cashu.space");
    await unmount();
  });
});
