import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "../test/render";
import { PaymentBanner, SuccessOverlay } from "./payments";

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

describe("PaymentBanner", () => {
  it("dismisses a settled payment when pressed", async () => {
    const onDismiss = vi.fn();
    await render(<PaymentBanner title="Sent" onDismiss={onDismiss} />);
    const banner = document.querySelector<HTMLElement>("[role=status]");
    await act(async () => banner?.click());
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("keeps a pending payment on screen when pressed", async () => {
    const onDismiss = vi.fn();
    await render(
      <PaymentBanner title="Sending" pending onDismiss={onDismiss} />,
    );
    const banner = document.querySelector<HTMLElement>("[role=status]");
    await act(async () => banner?.click());
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("lets touches through beside the card", async () => {
    const container = await render(
      <PaymentBanner title="Received" contained />,
    );
    const banner = container.querySelector<HTMLElement>("[role=status]");
    const host = banner?.parentElement;
    expect(host && getComputedStyle(host).pointerEvents).toBe("none");
    expect(banner && getComputedStyle(banner).pointerEvents).toBe("auto");
  });
});
