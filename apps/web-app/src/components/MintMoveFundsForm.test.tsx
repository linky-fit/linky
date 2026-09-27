import { AutoswapEstimate } from "@linky/linkshu";
import { Schema } from "effect";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MintMove } from "../app/hooks/mint/useMoveMintFunds";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { MintMoveFundsForm } from "./MintMoveFundsForm";

const decodeEstimate = Schema.decodeUnknownSync(AutoswapEstimate);
const t = (key: string): string => key;

const estimateFor = (move: MintMove, feeReserve: number) =>
  decodeEstimate({
    sourceMint: move.sourceMint,
    targetMint: move.targetMint,
    amount: move.amountSat,
    lightningFeeReserve: feeReserve,
    inputFee: 1,
    totalFromSource: move.amountSat + feeReserve + 1,
  });

const setInputValue = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setter) throw new Error("HTML input value setter missing");
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
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

const renderForm = async (feeReserve: number) => {
  const estimateMintMove = vi.fn(async (move: MintMove) =>
    estimateFor(move, feeReserve),
  );
  const moveMintFunds = vi.fn(async () => true);
  const rendered = await renderIntoDocument(
    <MintMoveFundsForm
      available={100}
      busy={false}
      estimateMintMove={estimateMintMove}
      moveMintFunds={moveMintFunds}
      sourceMint="https://cashu.cz"
      targets={["https://kashu.me"]}
      t={t}
    />,
  );
  const input = rendered.container.querySelector("#mintMoveAmount");
  if (!(input instanceof HTMLInputElement)) throw new Error("input missing");
  await act(async () => {
    setInputValue(input, "50");
  });
  await act(async () => {
    buttonNamed(rendered.container, "mintMoveEstimate").click();
  });
  return { ...rendered, estimateMintMove, moveMintFunds };
};

describe("MintMoveFundsForm", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the estimate before moving the requested amount", async () => {
    const { container, estimateMintMove, moveMintFunds, unmount } =
      await renderForm(4);
    const move = {
      sourceMint: "https://cashu.cz",
      targetMint: "https://kashu.me",
      amountSat: 50,
    };
    expect(estimateMintMove).toHaveBeenCalledWith(move);
    expect(container.textContent).toContain("55 sat");

    await act(async () => {
      buttonNamed(container, "mintMoveConfirm").click();
    });
    expect(moveMintFunds).toHaveBeenCalledWith(move);
    await unmount();
  });

  it("blocks a move whose fees exceed the balance", async () => {
    const { container, unmount } = await renderForm(60);
    expect(container.textContent).toContain("mintMoveExceedsBalance");
    expect(buttonNamed(container, "mintMoveConfirm").disabled).toBe(true);
    await unmount();
  });
});
