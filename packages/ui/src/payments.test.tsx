import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "../test/render";
import { SuccessOverlay } from "./payments";

describe("SuccessOverlay", () => {
  it("dismisses when pressed", async () => {
    const onDismiss = vi.fn();
    await render(<SuccessOverlay title="Paid" onDismiss={onDismiss} />);
    const overlay = document.querySelector<HTMLElement>("[role=status]");
    expect(overlay && getComputedStyle(overlay).pointerEvents).toBe("auto");
    await act(async () => overlay?.click());
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("renders in place when contained", async () => {
    const container = await render(<SuccessOverlay title="Paid" contained />);
    expect(container.querySelector("[role=status]")).not.toBeNull();
  });
});
