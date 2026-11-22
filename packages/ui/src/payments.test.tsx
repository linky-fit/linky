import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../test/render";
import { PaymentBanner, SuccessOverlay } from "./payments";

let clock = 0;

const dragY = async (
  target: Element,
  dy: number,
  options: {
    click?: boolean;
    release?: boolean;
    stepMs?: number;
    steps?: number;
  } = {},
) => {
  const { click = false, release = true, stepMs = 100, steps = 4 } = options;
  const mouse = (type: string, clientY: number) => {
    const event = new MouseEvent(type, { bubbles: true, buttons: 1, clientY });
    // The responder system reads page coordinates, which jsdom leaves at 0, and skips moves without a newer time.
    Object.defineProperties(event, {
      pageX: { value: 100 },
      pageY: { value: clientY },
      timeStamp: { value: (clock += stepMs) },
    });
    target.dispatchEvent(event);
  };
  await act(async () => {
    mouse("mousedown", 160);
    for (let step = 1; step <= steps; step += 1) {
      mouse("mousemove", 160 + (dy * step) / steps);
    }
    if (!release) return;
    mouse("mouseup", 160 + dy);
    if (click) mouse("click", 160 + dy);
  });
};

const bannerOffset = (banner: HTMLElement | null) =>
  Number(
    /translateY\((-?[\d.]+)px\)/u.exec(
      banner?.parentElement?.style.transform ?? "",
    )?.[1] ?? 0,
  );

afterEach(() => {
  vi.useRealTimers();
});

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

  it("dismisses a settled payment when swiped up on its own", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    await render(<PaymentBanner title="Sent" onDismiss={onDismiss} />);
    const banner = document.querySelector<HTMLElement>("[role=status]")!;
    await dragY(banner, -50);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("ignores the trailing click after a mouse swipe-up dismiss", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    await render(<PaymentBanner title="Sent" onDismiss={onDismiss} />);
    const banner = document.querySelector<HTMLElement>("[role=status]")!;
    await dragY(banner, -50, { click: true });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("dismisses on a quick upward flick even over a short distance", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    await render(<PaymentBanner title="Received" onDismiss={onDismiss} />);
    const banner = document.querySelector<HTMLElement>("[role=status]")!;
    await dragY(banner, -20, { stepMs: 5 });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("springs back from a short upward nudge without dismissing, and still closes on an immediate press", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    await render(<PaymentBanner title="Sent" onDismiss={onDismiss} />);
    const banner = document.querySelector<HTMLElement>("[role=status]")!;
    await dragY(banner, -16, { click: true });
    // Advance less than react-native-web's 250 ms click suppression window.
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => banner.click());
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("dismisses a settled payment when swiped up in a single move", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    await render(<PaymentBanner title="Sent" onDismiss={onDismiss} />);
    const banner = document.querySelector<HTMLElement>("[role=status]")!;
    await dragY(banner, -50, { steps: 1 });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("follows the pointer upward while dragging and never pulls down below rest", async () => {
    const onDismiss = vi.fn();
    await render(<PaymentBanner title="Sent" onDismiss={onDismiss} />);
    const banner = document.querySelector<HTMLElement>("[role=status]")!;
    await dragY(banner, -24, { release: false });
    expect(bannerOffset(banner)).toBe(-24);
    // Moving back down past the start clamps at rest instead of pulling the banner onto the screen.
    await act(async () => {
      const event = new MouseEvent("mousemove", {
        bubbles: true,
        buttons: 1,
        clientY: 200,
      });
      Object.defineProperties(event, {
        pageX: { value: 100 },
        pageY: { value: 200 },
        timeStamp: { value: (clock += 100) },
      });
      banner.dispatchEvent(event);
    });
    expect(bannerOffset(banner)).toBe(0);
  });

  it("keeps a pending payment on screen when pressed or swiped up", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    await render(
      <PaymentBanner title="Sending" pending onDismiss={onDismiss} />,
    );
    const banner = document.querySelector<HTMLElement>("[role=status]")!;
    await act(async () => banner.click());
    await dragY(banner, -60);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(bannerOffset(banner)).toBe(0);
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
