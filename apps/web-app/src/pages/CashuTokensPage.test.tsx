import { ProofStateSnapshot, TokenTransfer } from "@linky/linkshu";
import { Schema } from "effect";
import { act, type ComponentProps } from "react";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { createStoredProofFixture } from "../testUtils/cashuInventory";
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

const available = createStoredProofFixture({
  id: "AAAAAAAAAAAAAAAAAAAAAA",
  amount: 68,
});
const held = createStoredProofFixture({
  id: "AgICAgICAgICAgICAgICAg",
  amount: 32,
  state: "held",
  operationId: "AwMDAwMDAwMDAwMDAwMDAw",
});
const spent = createStoredProofFixture({
  id: "BAQEBAQEBAQEBAQEBAQEBA",
  amount: 5,
  state: "spent",
});
const issued = Schema.decodeUnknownSync(TokenTransfer)({
  id: "AQEBAQEBAQEBAQEBAQEBAQ",
  kind: "send",
  status: "issued",
  tokenText: "cashuBissued",
  mint: "https://mint.example",
  unit: "sat",
  amount: 21,
  error: null,
  createdAt: 1,
});
const snapshot = (
  proofId: string,
  state: ProofStateSnapshot["state"],
): ProofStateSnapshot =>
  Schema.decodeUnknownSync(ProofStateSnapshot)({ proofId, state });

const props = (
  inspect: () => Promise<readonly ProofStateSnapshot[]>,
): ComponentProps<typeof CashuTokensPage> => ({
  inspectCashuProofStates: inspect,
  canRestoreTokens: false,
  cashuBulkCheckIsBusy: false,
  cashuIsBusy: false,
  cashuMeltToMainMintButtonLabel: null,
  cashuProofs: [available, held, spent],
  cashuOpenTransfers: [issued],
  checkAllCashuTokensAndDeleteInvalid: async () => {},
  checkIssuedCashuTokensAndDeleteClaimed: async () => ({ claimed: [] }),
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

const sectionText = (container: HTMLElement, label: string) =>
  container.querySelector(`div[aria-label="${label}"]`)?.textContent ?? "";

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("CashuTokensPage inventory", () => {
  it("lists proofs by stored state with the mint's answer per row", async () => {
    const { container, unmount } = await renderIntoDocument(
      <CashuTokensPage
        {...props(async () => [
          snapshot(available.id, "unspent"),
          snapshot(held.id, "pending"),
        ])}
      />,
    );
    const availableSection = sectionText(container, "cashuProofStateAvailable");
    expect(availableSection).toContain("cashuProofStateAvailable · 68 sat");
    expect(availableSection).toContain("cashuMintStateUnspent");
    const heldSection = sectionText(container, "cashuProofStateHeld");
    expect(heldSection).toContain("cashuProofStateHeld · 32 sat");
    expect(heldSection).toContain("cashuMintStatePending");
    expect(heldSection).toContain("cashuHeldProofsHint");
    expect(container.textContent).toContain("1");
    expect(container.textContent).toContain("cashuSpentProofsKept");
    await unmount();
  });

  it("opens an open transfer from its pill", async () => {
    const { container, unmount } = await renderIntoDocument(
      <CashuTokensPage {...props(async () => [])} />,
    );
    const pill = container.querySelector(
      'button[aria-label^="cashuTransfers:"]',
    );
    assert(pill instanceof HTMLButtonElement);
    expect(pill.textContent).toContain("21 sat");
    await act(async () => pill.click());
    expect(navigateTo).toHaveBeenCalledWith({
      route: "cashuToken",
      id: issued.id,
    });
    await unmount();
  });

  it("re-asks the mint on refresh", async () => {
    const inspect = vi.fn(async () => [snapshot(available.id, "pending")]);
    const { container, unmount } = await renderIntoDocument(
      <CashuTokensPage {...props(inspect)} />,
    );
    expect(sectionText(container, "cashuProofStateAvailable")).toContain(
      "cashuMintStatePending",
    );
    inspect.mockResolvedValue([snapshot(available.id, "unspent")]);
    await clickButton(container, "cashuRefreshProofs");
    expect(sectionText(container, "cashuProofStateAvailable")).toContain(
      "cashuMintStateUnspent",
    );
    await unmount();
  });

  it("shows an unanswered proof as unknown", async () => {
    const { container, unmount } = await renderIntoDocument(
      <CashuTokensPage {...props(async () => [])} />,
    );
    expect(sectionText(container, "cashuProofStateAvailable")).toContain(
      "cashuMintStateUnknown",
    );
    await unmount();
  });

  it("does not apply an old mint response after the inventory changes", async () => {
    let finish: (reports: readonly ProofStateSnapshot[]) => void = () => {};
    const old = new Promise<readonly ProofStateSnapshot[]>((resolve) => {
      finish = resolve;
    });
    const inspect = vi
      .fn<() => Promise<readonly ProofStateSnapshot[]>>()
      .mockReturnValueOnce(old)
      .mockResolvedValue([snapshot(available.id, "unspent")]);
    const initialProps = props(inspect);
    const { container, rerender, unmount } = await renderIntoDocument(
      <CashuTokensPage {...initialProps} />,
    );
    await rerender(
      <CashuTokensPage {...initialProps} cashuProofs={[available, held]} />,
    );
    await act(async () => {
      finish([snapshot(available.id, "pending")]);
      await old;
    });
    expect(sectionText(container, "cashuProofStateAvailable")).toContain(
      "cashuMintStateUnspent",
    );
    await unmount();
  });
});
