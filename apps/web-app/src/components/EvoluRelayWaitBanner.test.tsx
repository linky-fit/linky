import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";

const state = vi.hoisted(() => ({ hydrated: false, online: true }));

vi.mock("../app/hooks/useLinksync", () => ({
  useAccountHydrated: () => state.hydrated,
}));
vi.mock("../hooks/useOnline", () => ({ useOnline: () => state.online }));

import { EvoluRelayWaitBanner } from "./EvoluRelayWaitBanner";

const t = (key: string) => key;

describe("EvoluRelayWaitBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.hydrated = false;
    state.online = true;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows once the account has waited for an Evolu relay a while, and goes when it hydrates", async () => {
    const view = await renderIntoDocument(<EvoluRelayWaitBanner t={t} />);
    expect(view.container.textContent).toBe("");

    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(view.container.textContent).toBe("evoluRelayWaiting");

    state.hydrated = true;
    await view.rerender(<EvoluRelayWaitBanner t={t} />);
    expect(view.container.textContent).toBe("");
    await view.unmount();
  });

  it("stays hidden offline, where nothing could sync anyway", async () => {
    state.online = false;
    const view = await renderIntoDocument(<EvoluRelayWaitBanner t={t} />);
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(view.container.textContent).toBe("");
    await view.unmount();
  });
});
