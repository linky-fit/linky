import { TokenProofStateAmounts, WalletToken } from "@linky/linkshu";
import { Schema } from "effect";
import { act, type ComponentProps } from "react";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { navigateTo } from "../hooks/useRouting";
import { CashuTokensPage } from "./CashuTokensPage";

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({
    t: (key: string) => key,
    formatDisplayedAmountText: (amount: number) => `${amount} sat`,
  }),
}));
vi.mock("../hooks/useRouting", () => ({ navigateTo: vi.fn() }));

const token = Schema.decodeUnknownSync(WalletToken)({
  id: "AAAAAAAAAAAAAAAAAAAAAA",
  state: "accepted",
  tokenText: "cashu-test-token",
  mint: "https://mint.example",
  unit: "sat",
  amount: 100,
  error: null,
  createdAt: 1,
});
const report = (unspent: number, pending: number, unknown = 0) =>
  Schema.decodeUnknownSync(TokenProofStateAmounts)({
    rowId: token.id,
    unspent,
    pending,
    unknown,
    spent: 0,
  });
const props = (
  inspect: () => Promise<readonly TokenProofStateAmounts[]>,
): ComponentProps<typeof CashuTokensPage> => ({
  inspectCashuTokenProofStates: inspect,
  canRestoreTokens: false,
  cashuTotalBalance: 100,
  cashuBulkCheckIsBusy: false,
  cashuIsBusy: false,
  cashuMeltToMainMintButtonLabel: null,
  cashuOwnTokens: [token],
  cashuOwnSpentTokensCount: 0,
  cashuIssuedTokens: [],
  checkAllCashuTokensAndDeleteInvalid: async () => {},
  checkIssuedCashuTokensAndDeleteClaimed: async () => ({ claimed: [] }),
  deleteSpentCashuTokens: async () => {},
  deleteSpentCashuTokensIsBusy: false,
  getMintIconUrl: () => ({
    url: null,
    host: "mint.example",
    origin: null,
    failed: false,
  }),
  meltLargestForeignMintToMainMint: async () => {},
  restoreMissingTokens: async () => {},
  setMintIconUrlByMint: () => {},
  tokensRestoreIsBusy: false,
});

const clickButton = async (container: HTMLElement, text: string) => {
  const button = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === text,
  );
  assert(button !== undefined);
  await act(async () => button.click());
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("CashuTokensPage mint status", () => {
  it("shows only the pending portion of a mixed token and opens its original row", async () => {
    const { container, unmount } = await renderIntoDocument(
      <CashuTokensPage {...props(async () => [report(68, 32)])} />,
    );
    expect(container.textContent).toContain("cashuAvailableProofs · 68 sat");
    const pending = container.querySelector(
      '[aria-label="cashuPendingAtMint"]',
    );
    expect(pending?.textContent).toContain("cashuPendingAtMint · 32 sat");
    const tokenButton = pending?.querySelector(
      'button[aria-label^="cashuPendingAtMint:"]',
    );
    assert(tokenButton instanceof HTMLButtonElement);
    expect(tokenButton.textContent).toContain("32 sat");
    await act(async () => tokenButton.click());
    expect(navigateTo).toHaveBeenCalledWith({
      route: "cashuToken",
      id: token.id,
    });
    await unmount();
  });

  it("moves released funds back to available after refresh", async () => {
    const inspect = vi.fn(async () => [report(68, 32)]);
    const { container, unmount } = await renderIntoDocument(
      <CashuTokensPage {...props(inspect)} />,
    );
    inspect.mockResolvedValue([report(100, 0)]);
    await clickButton(container, "cashuRefreshProofs");
    expect(container.textContent).toContain("cashuAvailableProofs · 100 sat");
    expect(container.textContent).toContain("cashuPendingAtMint · 0 sat");
    expect(container.textContent).toContain("cashuNoPendingProofs");
    await unmount();
  });

  it("shows unavailable funds as unknown instead of pending", async () => {
    const { container, unmount } = await renderIntoDocument(
      <CashuTokensPage {...props(async () => [report(0, 0, 100)])} />,
    );
    expect(container.textContent).toContain("cashuUnknownProofs · 100 sat");
    expect(container.textContent).toContain("cashuPendingAtMint · 0 sat");
    await unmount();
  });

  it("does not apply an old mint response after the token changes", async () => {
    let finish: (reports: readonly TokenProofStateAmounts[]) => void = () => {};
    const old = new Promise<readonly TokenProofStateAmounts[]>((resolve) => {
      finish = resolve;
    });
    const inspect = vi
      .fn<() => Promise<readonly TokenProofStateAmounts[]>>()
      .mockReturnValueOnce(old)
      .mockResolvedValue([report(100, 0)]);
    const initialProps = props(inspect);
    const { container, rerender, unmount } = await renderIntoDocument(
      <CashuTokensPage {...initialProps} />,
    );
    await rerender(
      <CashuTokensPage
        {...initialProps}
        cashuOwnTokens={[
          new WalletToken({ ...token, tokenText: token.tokenText }),
        ]}
      />,
    );
    await act(async () => {
      finish([report(0, 100)]);
      await old;
    });
    expect(container.textContent).toContain("cashuAvailableProofs · 100 sat");
    expect(container.textContent).toContain("cashuPendingAtMint · 0 sat");
    await unmount();
  });
});
