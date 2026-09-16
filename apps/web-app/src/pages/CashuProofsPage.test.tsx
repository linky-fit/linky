import { ProofStateSnapshot } from "@linky/linkshu";
import { Schema } from "effect";
import { act, type ComponentProps } from "react";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { createStoredProofFixture } from "../testUtils/cashuInventory";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { CashuProofsPage } from "./CashuProofsPage";

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({
    t: (key: string) =>
      key === "cashuSpentProofsKept" ? "cashuSpentProofsKept {count}" : key,
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
const snapshot = (
  proofId: string,
  state: ProofStateSnapshot["state"],
): ProofStateSnapshot =>
  Schema.decodeUnknownSync(ProofStateSnapshot)({ proofId, state });

const props = (
  inspect: () => Promise<readonly ProofStateSnapshot[]>,
): ComponentProps<typeof CashuProofsPage> => ({
  inspectCashuProofStates: inspect,
  canRestoreTokens: false,
  cashuBulkCheckIsBusy: false,
  cashuIsBusy: false,
  cashuMeltToMainMintButtonLabel: null,
  cashuProofs: [available, held, spent],
  checkAllCashuTokensAndDeleteInvalid: async () => {},
  checkIssuedCashuTokensAndDeleteClaimed: async () => ({ claimed: [] }),
  meltLargestForeignMintToMainMint: async () => {},
  restoreMissingTokens: async () => {},
  reclaimHandedOutTokens: async () => {},
  restoreAndReclaimAllTokens: async () => {},
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

describe("CashuProofsPage inventory", () => {
  it("lists proofs by stored state with the mint's answer per row", async () => {
    const { container, unmount } = await renderIntoDocument(
      <CashuProofsPage
        {...props(async () => [
          snapshot(available.id, "unspent"),
          snapshot(held.id, "pending"),
        ])}
      />,
    );
    for (const proof of [available, held, spent]) {
      expect(container.outerHTML).not.toContain(proof.secret);
      expect(container.outerHTML).not.toContain(proof.C);
    }
    const availableSection = sectionText(container, "cashuProofStateAvailable");
    expect(availableSection).toContain("cashuProofStateAvailable · 68 sat");
    expect(availableSection).toContain("cashuMintStateUnspent");
    const heldSection = sectionText(container, "cashuProofStateHeld");
    expect(heldSection).toContain("cashuProofStateHeld · 32 sat");
    expect(heldSection).toContain("cashuMintStatePending");
    expect(heldSection).toContain("cashuHeldProofsHint");
    expect(container.textContent).toContain("cashuSpentProofsKept 1");
    expect(container.textContent).toContain("cashuSpentProofsKept");
    await unmount();
  });

  it("re-asks the mint on refresh", async () => {
    const inspect = vi.fn(async () => [snapshot(available.id, "pending")]);
    const { container, unmount } = await renderIntoDocument(
      <CashuProofsPage {...props(inspect)} />,
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
      <CashuProofsPage {...props(async () => [])} />,
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
      <CashuProofsPage {...initialProps} />,
    );
    await rerender(
      <CashuProofsPage {...initialProps} cashuProofs={[available, held]} />,
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

it("offers reclaim for NFC proofs even with no open transfers, and puts full recovery last", async () => {
  const reclaimHandedOutTokens = vi.fn(async () => {});
  const restoreAndReclaimAllTokens = vi.fn(async () => {});
  const pageProps = {
    ...props(async () => []),
    canRestoreTokens: true,
    cashuProofs: [createStoredProofFixture({ state: "externalized" })],
    reclaimHandedOutTokens,
    restoreAndReclaimAllTokens,
  };
  const { container } = await renderIntoDocument(
    <CashuProofsPage {...pageProps} />,
  );
  await clickButton(container, "cashuReclaimHandedOut");
  expect(reclaimHandedOutTokens).toHaveBeenCalledOnce();
  await clickButton(container, "cashuRestoreAndReclaimAll");
  expect(restoreAndReclaimAllTokens).toHaveBeenCalledOnce();
  expect(
    [...container.querySelectorAll("section button")].at(-1)?.textContent,
  ).toBe("cashuRestoreAndReclaimAll");
});
