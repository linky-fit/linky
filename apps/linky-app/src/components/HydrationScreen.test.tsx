import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { HYDRATION_ESCAPE_AFTER_MS, HydrationScreen } from "./HydrationScreen";

const t = (key: string) =>
  key === "hydrationProgress" ? "{synced} of {total}" : key;

const relaySettingsButton = () =>
  Array.from(document.body.querySelectorAll('[role="button"], button')).find(
    (element) => element.textContent === "hydrationOpenRelaySettings",
  );

describe("HydrationScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts the synced owners and offers the Evolu relays only once the wait runs long", async () => {
    const onOpenRelaySettings = vi.fn();
    const view = await renderIntoDocument(
      <HydrationScreen
        synced={2}
        total={7}
        onOpenRelaySettings={onOpenRelaySettings}
        t={t}
      />,
    );
    expect(view.container.textContent).toContain("2 of 7");
    expect(view.container.textContent).toContain("hydrationBody");
    expect(relaySettingsButton()).toBeUndefined();

    await act(async () => {
      vi.advanceTimersByTime(HYDRATION_ESCAPE_AFTER_MS);
    });
    expect(view.container.textContent).toContain("hydrationSlowBody");
    await act(async () => {
      relaySettingsButton()?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(onOpenRelaySettings).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
