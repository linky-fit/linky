import { Either } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MintSettingsContextValue } from "../app/context/SystemSettingsContexts";
import {
  createMintSettings,
  decodeProbeResult,
  probeLightningFee,
} from "../testUtils/mintSettings";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { MintFees } from "./MintFees";

let mintSettings: MintSettingsContextValue;

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({ t: (key: string) => key }),
}));

vi.mock("../app/context/SystemSettingsContexts", () => ({
  useMintSettingsContext: () => mintSettings,
}));

const withFeesJson = (mint: string, feesJson: string) =>
  new Map([[mint, { id: "row", url: mint, feesJson }]]);

describe("MintFees", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    probeLightningFee.mockClear();
  });

  it("requests the mint info while the keyset fee is unknown", async () => {
    const refreshMintInfo = vi.fn(async () => {});
    mintSettings = createMintSettings({ refreshMintInfo });

    const { container, unmount } = await renderIntoDocument(
      <MintFees mint="https://cashu.cz/" />,
    );
    expect(refreshMintInfo).toHaveBeenCalledWith("https://cashu.cz");
    expect(container.textContent).toContain("mintFeeCashuPaymentsunknown");
    await unmount();
  });

  it("shows the keyset fee in sats, the free top-up and the Lightning fee", async () => {
    const refreshMintInfo = vi.fn(async () => {});
    mintSettings = createMintSettings({
      mintInfoByUrl: withFeesJson(
        "https://cashu.cz",
        JSON.stringify({ ppk: 100, raw: null }),
      ),
      refreshMintInfo,
    });

    const { container, unmount } = await renderIntoDocument(
      <MintFees mint="https://cashu.cz" />,
    );
    expect(refreshMintInfo).not.toHaveBeenCalled();
    expect(container.textContent).toContain("mintFeeCashuPayments~1 sat");
    expect(container.textContent).toContain("mintFeeLightningTopup0 sat");
    expect(probeLightningFee).toHaveBeenCalledWith({
      mint: "https://cashu.cz",
      probeMint: "https://mint.minibits.cash/Bitcoin",
    });
    expect(container.textContent).toContain("mintFeeLightningPayments~1.2 %");
    await unmount();
  });

  it("keeps the Lightning fee's tenths above ten percent", async () => {
    probeLightningFee.mockResolvedValueOnce(
      Either.right(
        decodeProbeResult({
          mint: "https://kashu.me",
          probeMint: "https://cashu.cz",
          amount: 10000,
          feeReserve: 1250,
          percent: 12.5,
        }),
      ),
    );
    mintSettings = createMintSettings();
    const { container, unmount } = await renderIntoDocument(
      <MintFees mint="https://kashu.me" />,
    );
    expect(container.textContent).toContain("~12.5 %");
    await unmount();
  });

  it("does not probe a test mint's Lightning fee", async () => {
    mintSettings = createMintSettings();
    const { container, unmount } = await renderIntoDocument(
      <MintFees mint="http://localhost:3338" />,
    );
    expect(probeLightningFee).not.toHaveBeenCalled();
    expect(container.textContent).toContain("mintFeeLightningPaymentsunknown");
    await unmount();
  });
});
