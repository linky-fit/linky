import type { OwnerId } from "@evolu/common";
import { LightningFeeProbeResult } from "@linky/linkshu";
import { Either, Schema } from "effect";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import type { MintSettingsContextValue } from "../app/context/SystemSettingsContexts";
import type { ProbeLightningFee } from "../app/hooks/composition/useLinkshuComposition";
import { MintsPage } from "./MintsPage";

let mintSettings: MintSettingsContextValue;

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({ t: (key: string) => key }),
}));

vi.mock("../app/context/SystemSettingsContexts", () => ({
  useMintSettingsContext: () => mintSettings,
}));

const decodeProbeResult = Schema.decodeUnknownSync(LightningFeeProbeResult);
const probeLightningFee = vi.fn<ProbeLightningFee>(
  async ({ mint, probeMint }) =>
    Either.right(
      decodeProbeResult({
        mint,
        probeMint,
        amount: 10000,
        feeReserve: 120,
        percent: 1.2,
      }),
    ),
);

const appOwnerIdRef = React.createRef<OwnerId>();

const createMintSettings = (
  overrides: Partial<MintSettingsContextValue> = {},
): MintSettingsContextValue => ({
  appOwnerIdRef,
  applyDefaultMintSelection: vi.fn(async () => {}),
  cashuIsBusy: false,
  cashuMeltToMainMintButtonLabel: "Melt foreign balance",
  defaultMintUrl: "https://cashu.cz",
  defaultMintUrlDraft: "https://custom.example",
  getMintIconUrl: () => ({
    failed: false,
    host: null,
    origin: null,
    url: null,
  }),
  getMintRuntime: () => null,
  meltLargestForeignMintToMainMint: vi.fn(async () => {}),
  mintInfoByUrl: new Map(),
  pendingMintDeleteUrl: null,
  probeLightningFee,
  refreshMintInfo: async () => {},
  setDefaultMintUrlDraft: vi.fn(),
  setMintInfoAll: vi.fn(),
  setPendingMintDeleteUrl: vi.fn(),
  setStatus: vi.fn(),
  ...overrides,
});

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

  it("routes preset selection and custom save to their callbacks", async () => {
    const applyDefaultMintSelection = vi.fn(async () => {});
    mintSettings = createMintSettings({ applyDefaultMintSelection });

    const { container, root } = await renderIntoDocument(<MintsPage />);

    await act(async () => {
      click(findButton(container, "kashu.me"));
    });
    expect(applyDefaultMintSelection).toHaveBeenCalledWith("https://kashu.me");

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

  it("shows the selected mint's keyset fee and requests a refresh when unknown", async () => {
    const refreshMintInfo = vi.fn(async () => {});
    mintSettings = createMintSettings({ refreshMintInfo });

    const { container, root } = await renderIntoDocument(<MintsPage />);
    expect(refreshMintInfo).toHaveBeenCalledWith("https://cashu.cz");
    expect(container.textContent).toContain("unknown");

    mintSettings = createMintSettings({
      mintInfoByUrl: new Map([
        [
          "https://cashu.cz",
          {
            id: "row",
            url: "https://cashu.cz",
            feesJson: JSON.stringify({ ppk: 100, raw: null }),
          },
        ],
      ]),
    });
    await act(async () => {
      root.render(<MintsPage />);
    });
    expect(container.textContent).toContain("~1 sat");
    expect(probeLightningFee).toHaveBeenCalledWith({
      mint: "https://cashu.cz",
      probeMint: "https://mint.minibits.cash/Bitcoin",
    });
    expect(container.textContent).toContain("~1.2 %");

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps the Lightning fee's tenths above ten percent", async () => {
    probeLightningFee.mockResolvedValueOnce(
      Either.right(
        decodeProbeResult({
          mint: "https://cashu.cz",
          probeMint: "https://mint.minibits.cash/Bitcoin",
          amount: 10000,
          feeReserve: 1250,
          percent: 12.5,
        }),
      ),
    );
    mintSettings = createMintSettings();
    const { container, unmount } = await renderIntoDocument(<MintsPage />);
    expect(container.textContent).toContain("~12.5 %");
    await unmount();
  });

  it("updates the custom draft and blocks selection and save while busy", async () => {
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

    const presetButton = findButton(container, "kashu.me");
    const saveButton = findButton(container, "saveChanges");
    expect(presetButton.disabled).toBe(true);
    expect(saveButton.disabled).toBe(true);

    await act(async () => {
      click(presetButton);
      click(saveButton);
    });
    expect(applyDefaultMintSelection).not.toHaveBeenCalled();
    expect(setDefaultMintUrlDraft).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
