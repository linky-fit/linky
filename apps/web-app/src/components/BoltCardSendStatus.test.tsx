import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BoltCardSessionPhase,
  useBoltCardSession,
} from "../app/hooks/useBoltCardSession";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";

type SessionParams = Parameters<typeof useBoltCardSession>[0];

interface State {
  armOnSend: boolean;
  supported: boolean;
  phase: BoltCardSessionPhase;
  start: ReturnType<typeof vi.fn>;
  params: SessionParams | null;
  submitInvoice: ReturnType<typeof vi.fn>;
}

const state = vi.hoisted(
  (): State => ({
    armOnSend: false,
    supported: true,
    phase: { kind: "idle" },
    start: vi.fn(),
    params: null,
    submitInvoice: vi.fn(),
  }),
);

vi.mock("../app/hooks/useBoltCardArmOnSend", () => ({
  useBoltCardArmOnSend: () => ({
    armOnSend: state.armOnSend,
    setArmOnSend: vi.fn(),
  }),
}));

vi.mock("../platform/nativeBridge", () => ({
  supportsNativeBoltCard: () => state.supported,
}));

vi.mock("../app/hooks/useBoltCardSession", () => ({
  useBoltCardSession: (params: SessionParams) => {
    state.params = params;
    return { phase: state.phase, start: state.start, stop: vi.fn() };
  },
}));

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({
    cashuBalance: 10_000,
    formatDisplayedAmountText: (sat: number) => `${sat} sat`,
    t: (key: string) =>
      key === "boltCardSendActive" ? "Card on, up to {amount}" : key,
  }),
  useMoneyRoutes: () => ({
    manualPayProps: { onSubmitText: state.submitInvoice },
  }),
}));

import { BoltCardSendStatus } from "./BoltCardSendStatus";

describe("BoltCardSendStatus", () => {
  beforeEach(() => {
    state.armOnSend = false;
    state.supported = true;
    state.phase = { kind: "idle" };
    state.start = vi.fn();
    state.params = null;
    state.submitInvoice = vi.fn(async () => undefined);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("stays off until the synced switch is on", async () => {
    const { container, unmount } = await renderIntoDocument(
      <BoltCardSendStatus />,
    );
    expect(container.innerHTML).toBe("");
    expect(state.start).not.toHaveBeenCalled();
    await unmount();
  });

  it("stays off on a device that cannot emulate a card", async () => {
    state.armOnSend = true;
    state.supported = false;
    const { container, unmount } = await renderIntoDocument(
      <BoltCardSendStatus />,
    );
    expect(container.innerHTML).toBe("");
    expect(state.start).not.toHaveBeenCalled();
    await unmount();
  });

  it("arms the card as soon as Send shows it and states the limit", async () => {
    state.armOnSend = true;
    state.phase = { kind: "ready" };
    const { container, unmount } = await renderIntoDocument(
      <BoltCardSendStatus />,
    );
    expect(state.start).toHaveBeenCalledTimes(1);
    // 10 000 sat spendable minus the 1 % fee reserve.
    expect(container.textContent).toContain("Card on, up to 9900 sat");
    expect(container.querySelector("button")).toBeNull();
    await unmount();
  });

  it("hands the accepted invoice to the scanned-invoice path", async () => {
    state.armOnSend = true;
    const { unmount } = await renderIntoDocument(<BoltCardSendStatus />);
    state.params?.onInvoice("lnbc1invoice");
    expect(state.submitInvoice).toHaveBeenCalledWith("lnbc1invoice");
    await unmount();
  });

  it("offers a retry after a failure", async () => {
    state.armOnSend = true;
    state.phase = { kind: "failed", error: "bridge" };
    const { container, unmount } = await renderIntoDocument(
      <BoltCardSendStatus />,
    );
    expect(container.textContent).toContain("boltCardErrorBridge");
    const retry = container.querySelector("button");
    await act(async () => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(state.start).toHaveBeenCalledTimes(2);
    await unmount();
  });
});
