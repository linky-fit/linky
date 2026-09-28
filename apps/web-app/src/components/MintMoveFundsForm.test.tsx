import { AutoswapEstimate } from "@linky-fit/linkshu";
import { Schema } from "effect";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MintMove } from "../app/hooks/mint/useMoveMintFunds";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { applyAmountInputKeyWithDraft } from "../utils/displayAmounts";
import { MintMoveFundsForm } from "./MintMoveFundsForm";

const satOptions = { displayCurrency: "sat", fiatRates: null } as const;

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({
    allowedDisplayCurrencies: ["sat"],
    applyAmountInputKeyWithDraft: (
      currentAmount: string,
      currentDisplayValue: string | null,
      key: string,
    ) =>
      applyAmountInputKeyWithDraft(
        currentAmount,
        currentDisplayValue,
        key,
        satOptions,
        false,
      ),
    decimalAmountInputKeyVisible: false,
    displayCurrency: "sat",
    displayUnit: "sat",
    formatDisplayedAmountParts: (amountSat: number) => ({
      amountText: String(amountSat),
      approxPrefix: "",
      unitLabel: "sat",
    }),
    formatDisplayedAmountText: (amountSat: number) => `${amountSat} sat`,
    lang: "en",
    t: (key: string) => key,
  }),
  useAppShellActions: () => ({ cycleDisplayCurrency: vi.fn() }),
}));

const decodeEstimate = Schema.decodeUnknownSync(AutoswapEstimate);

const AVAILABLE = 100;
const INPUT_FEE = 1;
const SOURCE_MINT = "https://cashu.cz";
const TARGET_MINT = "https://kashu.me";
const OTHER_TARGET_MINT = "http://localhost:3339";

const noMintIcon = () => ({
  failed: false,
  host: null,
  origin: null,
  url: null,
});

/** A sweep is priced at its first attempt: the balance minus the input fee. */
const estimateFor = (move: MintMove, feeReserve: number) => {
  const amount = move.amountSat ?? AVAILABLE - INPUT_FEE;
  return decodeEstimate({
    sourceMint: move.sourceMint,
    targetMint: move.targetMint,
    amount,
    lightningFeeReserve: feeReserve,
    inputFee: INPUT_FEE,
    totalFromSource: amount + feeReserve + INPUT_FEE,
  });
};

const buttonNamed = (container: HTMLElement, text: string) => {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === text,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`button missing: ${text}`);
  }
  return button;
};

const press = async (container: HTMLElement, keys: readonly string[]) => {
  for (const key of keys) {
    await act(async () => {
      buttonNamed(container, key).click();
    });
  }
};

const renderForm = async (feeReserve: number) => {
  const estimateMintMove = vi.fn(async (move: MintMove) =>
    estimateFor(move, feeReserve),
  );
  const moveMintFunds = vi.fn<(move: MintMove) => Promise<boolean>>(
    async () => true,
  );
  const rendered = await renderIntoDocument(
    <MintMoveFundsForm
      available={AVAILABLE}
      busy={false}
      estimateMintMove={estimateMintMove}
      getMintIconUrl={noMintIcon}
      moveMintFunds={moveMintFunds}
      sourceMint={SOURCE_MINT}
      targets={[TARGET_MINT, OTHER_TARGET_MINT]}
    />,
  );
  return { ...rendered, estimateMintMove, moveMintFunds };
};

const amountShown = (container: HTMLElement) =>
  container.querySelector(".amount-number")?.textContent;

describe("MintMoveFundsForm", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("sweeps the whole balance it opens with, fees coming out of it", async () => {
    const { container, estimateMintMove, moveMintFunds, unmount } =
      await renderForm(4);
    expect(amountShown(container)).toBe(String(AVAILABLE));

    await press(container, ["mintMoveEstimate"]);
    const sweep = { sourceMint: SOURCE_MINT, targetMint: TARGET_MINT };
    expect(estimateMintMove.mock.calls[0]?.[0]).toStrictEqual(sweep);
    const values = Array.from(container.querySelectorAll("dd")).map(
      (value) => value.textContent,
    );
    expect(values).toEqual(["95 sat", "4 sat", "1 sat", "100 sat"]);
    expect(container.textContent).toContain("mintMoveSweepNote");

    await press(container, ["mintMoveConfirm"]);
    expect(moveMintFunds.mock.calls[0]?.[0]).toStrictEqual(sweep);
    await unmount();
  });

  it("takes an explicit amount on the keypad and shows the estimate before moving", async () => {
    const { container, estimateMintMove, moveMintFunds, unmount } =
      await renderForm(4);
    await press(container, ["C", "5", "0", "mintMoveEstimate"]);
    const move = {
      sourceMint: SOURCE_MINT,
      targetMint: TARGET_MINT,
      amountSat: 50,
    };
    expect(estimateMintMove).toHaveBeenCalledWith(move);
    expect(container.textContent).toContain("55 sat");
    expect(container.textContent).toContain("mintMoveEstimateNote");

    await press(container, ["mintMoveConfirm"]);
    expect(moveMintFunds).toHaveBeenCalledWith(move);
    await unmount();
  });

  it("blocks a move whose fees exceed the balance", async () => {
    const { container, unmount } = await renderForm(60);
    await press(container, ["C", "5", "0", "mintMoveEstimate"]);
    expect(container.textContent).toContain("mintMoveExceedsBalance");
    expect(buttonNamed(container, "mintMoveConfirm").disabled).toBe(true);
    await unmount();
  });

  it("picks the target from the mint buttons, the preferred one first", async () => {
    const { container, estimateMintMove, unmount } = await renderForm(4);
    const group = container.querySelector(
      '[role="group"][aria-label="mintMoveTarget"]',
    );
    const targetButtons = Array.from(group?.querySelectorAll("button") ?? []);
    expect(
      targetButtons.map((button) => [
        button.querySelector(".mint-choice-label")?.textContent,
        button.querySelector(".mint-choice-badge")?.textContent,
        button.getAttribute("aria-pressed"),
      ]),
    ).toEqual([
      ["kashu.me", undefined, "true"],
      ["localhost:3339", "testMintBadge", "false"],
    ]);
    expect(group?.querySelectorAll(".mint-icon-fallback")).toHaveLength(2);

    await act(async () => {
      targetButtons[1]?.click();
    });
    expect(targetButtons[1]?.getAttribute("aria-pressed")).toBe("true");
    await press(container, ["mintMoveEstimate"]);
    expect(estimateMintMove.mock.calls[0]?.[0].targetMint).toBe(
      OTHER_TARGET_MINT,
    );
    await unmount();
  });

  it("cannot estimate more than the balance", async () => {
    const { container, unmount } = await renderForm(4);
    await press(container, ["5"]);
    expect(amountShown(container)).toBe(`${AVAILABLE}5`);
    expect(buttonNamed(container, "mintMoveEstimate").disabled).toBe(true);
    await unmount();
  });
});
