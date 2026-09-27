import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MintSettingsContextValue } from "../app/context/SystemSettingsContexts";
import { createMintSettings } from "../testUtils/mintSettings";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { MintDetailPage } from "./MintDetailPage";

let mintSettings: MintSettingsContextValue;
let mintUrl = "https://cashu.cz";

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({
    formatDisplayedAmountText: (amount: number) => `${amount} sat`,
    lang: "en",
    route: { kind: "mint", mintUrl },
    t: (key: string) => key,
  }),
}));

vi.mock("../app/context/SystemSettingsContexts", () => ({
  useMintSettingsContext: () => mintSettings,
}));

const badgeTexts = (container: HTMLElement): string[] =>
  Array.from(
    container.querySelectorAll(".mint-detail-identity .mint-choice-badge"),
  ).map((badge) => badge.textContent ?? "");

describe("MintDetailPage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("names the default mint in its header with the list's badges", async () => {
    mintUrl = "https://cashu.cz";
    mintSettings = createMintSettings();

    const { container, unmount } = await renderIntoDocument(<MintDetailPage />);
    expect(container.querySelector(".mint-detail-name")?.textContent).toBe(
      "cashu.cz",
    );
    expect(badgeTexts(container)).toEqual([
      "defaultMintBadge",
      "recommendedMintBadge",
    ]);
    expect(container.textContent).not.toContain("mintSetAsDefault");
    expect(container.querySelector(".mint-fees")).not.toBeNull();
    await unmount();
  });

  it("offers to make another mint the default", async () => {
    mintUrl = "https://mint.minibits.cash/Bitcoin";
    const applyDefaultMintSelection = vi.fn(async () => {});
    mintSettings = createMintSettings({ applyDefaultMintSelection });

    const { container, unmount } = await renderIntoDocument(<MintDetailPage />);
    expect(container.querySelector(".mint-detail-name")?.textContent).toBe(
      "mint.minibits.cash/Bitcoin",
    );
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
