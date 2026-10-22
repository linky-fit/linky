import { UIProvider } from "@linky-fit/ui";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OperatorTransfer } from "../domain/transfer";
import { operatorTransferOf } from "../domain/testing/transfers";
import { StatsScreen } from "./StatsScreen";

const sec = (iso: string) => Date.parse(iso) / 1000;

const state: { transfers: readonly OperatorTransfer[] } = vi.hoisted(() => ({
  transfers: [],
}));

vi.mock("../services/react", () => ({ useTransfers: () => state.transfers }));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const text = (testId: string) =>
  document.querySelector(`[data-testid="${testId}"]`)?.textContent ?? "";

const choosePeriod = (label: string) =>
  act(async () => {
    const option = [
      ...document.querySelectorAll<HTMLElement>('[role="radio"]'),
    ].find((element) => element.textContent === label);
    if (option === undefined) throw new Error(`no period ${label}`);
    option.click();
  });

it("recomputes the totals and outcomes for the chosen period", async () => {
  state.transfers = [
    operatorTransferOf({
      status: "completed",
      direction: "receive",
      amount: 100_000,
      fee: 1_000,
      createdAtSec: sec("2026-10-14T12:00:00Z"),
    }),
    operatorTransferOf({
      status: "completed",
      direction: "send",
      amount: 200_000,
      fee: 2_000,
      createdAtSec: sec("2026-09-25T12:00:00Z"),
    }),
    operatorTransferOf({
      status: "completed",
      direction: "send",
      amount: 50_000,
      fee: 500,
      createdAtSec: sec("2025-03-01T12:00:00Z"),
    }),
    operatorTransferOf({
      status: "refunded",
      amount: 400_000,
      createdAtSec: sec("2026-10-10T12:00:00Z"),
    }),
  ];
  await act(() =>
    root.render(
      <UIProvider mode="dark">
        <StatsScreen />
      </UIProvider>,
    ),
  );

  expect(text("stats-volume")).toContain("350 000");
  expect(text("stats-fees")).toContain("3 500");
  expect(text("stats-sent")).toContain("353 500 sat");
  expect(text("stats-direction-send")).toContain("250 000 sat");
  expect(text("stats-screen")).toContain("By month");

  await choosePeriod("This month");
  expect(text("stats-volume")).toContain("100 000");
  expect(text("stats-fees")).toContain("1 000");
  expect(text("stats-direction-send")).toContain("0 transfers");
  expect(text("stats-outcome-completed")).toBe("Completed1");
  expect(text("stats-outcome-refunded")).toBe("Refunded1");
  expect(text("stats-screen")).not.toContain("By month");

  await choosePeriod("Last 30 days");
  expect(text("stats-volume")).toContain("300 000");
  expect(text("stats-fees")).toContain("3 000");
  expect(text("stats-outcome-completed")).toBe("Completed2");
});
