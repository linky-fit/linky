import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MintSettingsContextValue } from "../app/context/SystemSettingsContexts";
import { createMintSettings } from "../testUtils/mintSettings";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { MintNewPage } from "./MintNewPage";

let mintSettings: MintSettingsContextValue;

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("../hooks/useRouting", () => ({
  navigateTo: mockNavigate,
}));

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({ t: (key: string) => key }),
}));

vi.mock("../app/context/SystemSettingsContexts", () => ({
  useMintSettingsContext: () => mintSettings,
}));

const renderPage = async () => {
  const rendered = await renderIntoDocument(<MintNewPage />);
  const input = rendered.container.querySelector("#mintUrl");
  const button = rendered.container.querySelector("button");
  if (!(input instanceof HTMLInputElement)) throw new Error("input missing");
  if (!(button instanceof HTMLButtonElement)) throw new Error("button missing");
  return { ...rendered, button, input };
};

const typeInto = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const click = async (button: HTMLButtonElement) => {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("MintNewPage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    mockNavigate.mockReset();
  });

  it("makes the typed mint the default and opens its detail page", async () => {
    const applyDefaultMintSelection = vi.fn(async () => true);
    mintSettings = createMintSettings({ applyDefaultMintSelection });
    const { button, input, unmount } = await renderPage();

    expect(button.disabled).toBe(true);
    await typeInto(input, "kashu.me");
    await click(button);

    expect(applyDefaultMintSelection).toHaveBeenCalledWith("https://kashu.me");
    expect(mockNavigate).toHaveBeenCalledWith({
      route: "mint",
      mintUrl: "https://kashu.me",
    });
    await unmount();
  });

  it("stays on the page when the default did not change", async () => {
    const applyDefaultMintSelection = vi.fn(async () => false);
    mintSettings = createMintSettings({ applyDefaultMintSelection });
    const { button, input, unmount } = await renderPage();

    await typeInto(input, "https://kashu.me");
    await click(button);

    expect(applyDefaultMintSelection).toHaveBeenCalledWith("https://kashu.me");
    expect(mockNavigate).not.toHaveBeenCalled();
    await unmount();
  });

  it("refuses a URL without a real hostname", async () => {
    const applyDefaultMintSelection = vi.fn(async () => true);
    const setStatus = vi.fn();
    mintSettings = createMintSettings({ applyDefaultMintSelection, setStatus });
    const { button, input, unmount } = await renderPage();

    await typeInto(input, "not a mint");
    await click(button);

    expect(setStatus).toHaveBeenCalledWith("mintUrlInvalid");
    expect(applyDefaultMintSelection).not.toHaveBeenCalled();
    await unmount();
  });

  it("accepts a local test mint without a dotted hostname", async () => {
    const applyDefaultMintSelection = vi.fn(async () => true);
    mintSettings = createMintSettings({ applyDefaultMintSelection });
    const { button, input, unmount } = await renderPage();

    await typeInto(input, "http://localhost:3339");
    await click(button);

    expect(applyDefaultMintSelection).toHaveBeenCalledWith(
      "http://localhost:3339",
    );
    await unmount();
  });

  it("blocks the save while the wallet is busy", async () => {
    const applyDefaultMintSelection = vi.fn(async () => true);
    mintSettings = createMintSettings({
      applyDefaultMintSelection,
      cashuIsBusy: true,
    });
    const { button, input, unmount } = await renderPage();

    await typeInto(input, "kashu.me");
    expect(button.disabled).toBe(true);
    await click(button);

    expect(applyDefaultMintSelection).not.toHaveBeenCalled();
    await unmount();
  });

  it("refuses a test mint while test mints are off", async () => {
    const applyDefaultMintSelection = vi.fn(async () => true);
    const setStatus = vi.fn();
    mintSettings = createMintSettings({
      allowTestMints: false,
      applyDefaultMintSelection,
      setStatus,
    });
    const { button, input, unmount } = await renderPage();

    await typeInto(input, "https://testnut.cashu.space");
    await click(button);

    expect(setStatus).toHaveBeenCalledWith("mintTestMintNotAllowed");
    expect(applyDefaultMintSelection).not.toHaveBeenCalled();
    await unmount();
  });
});
