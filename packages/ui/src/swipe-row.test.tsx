import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "../test/render";
import { ListRow } from "./lists";
import { SwipeRow, swipeRevealWidth } from "./swipe-row";

// At the default 360 px width the row stops short of 216 px and runs the action past 144 px of travel.
const SHORT_SWIPE = 100;
const LONG_SWIPE = 600;

const renderRow = async () => {
  const hide = vi.fn();
  const pin = vi.fn();
  const open = vi.fn();
  const container = await render(
    <SwipeRow
      swipeLeft={{
        icon: "EyeOff",
        label: "Hide",
        tone: "neutral",
        onTrigger: hide,
      }}
      swipeRight={{ icon: "Pin", label: "Pin", tone: "accent", onTrigger: pin }}
    >
      <ListRow title="Bread" onPress={open} />
    </SwipeRow>,
  );
  const button = container.querySelector("button")!;
  const travel = () =>
    Number(
      /translateX\((-?[\d.]+)px\)/u.exec(
        container.querySelector<HTMLElement>("[style*=translateX]")?.style
          .transform ?? "",
      )?.[1] ?? 0,
    );
  const actionLabel = (label: string) =>
    [...container.querySelectorAll("*")].find(
      (element) =>
        element.children.length === 0 && element.textContent === label,
    );
  return { button, hide, pin, open, travel, actionLabel };
};

let clock = 0;

const drag = async (target: Element, dx: number, release = true) => {
  const mouse = (type: string, clientX: number) => {
    const event = new MouseEvent(type, { bubbles: true, buttons: 1, clientX });
    // The responder system reads page coordinates, which the DOM here leaves at 0, and skips moves without a newer time.
    Object.defineProperties(event, {
      pageX: { value: clientX },
      pageY: { value: 0 },
      timeStamp: { value: (clock += 10) },
    });
    target.dispatchEvent(event);
  };
  await act(async () => {
    mouse("mousedown", 200);
    for (let step = 1; step <= 4; step += 1)
      mouse("mousemove", 200 + (dx * step) / 4);
    if (!release) return;
    mouse("mouseup", 200 + dx);
    mouse("click", 200 + dx);
  });
};

const wheel = async (target: Element, deltas: ReadonlyArray<number>) => {
  await act(async () => {
    for (const deltaX of deltas)
      target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaX }));
  });
};

describe("SwipeRow", () => {
  it("runs the action of the side pulled far, without opening the row", async () => {
    const { button, hide, pin, open } = await renderRow();
    await drag(button, -LONG_SWIPE);
    expect(hide).toHaveBeenCalledOnce();
    await drag(button, LONG_SWIPE);
    expect(pin).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });

  it("leaves the action open after a short swipe, to run on a press", async () => {
    const { button, hide, actionLabel } = await renderRow();
    await drag(button, -SHORT_SWIPE);
    expect(hide).not.toHaveBeenCalled();
    const label = actionLabel("Hide");
    expect(label).toBeInstanceOf(HTMLElement);
    if (label instanceof HTMLElement) await act(async () => label.click());
    expect(hide).toHaveBeenCalledOnce();
  });

  it("closes an open row on a press of the row, which opens nothing", async () => {
    const { button, hide, open } = await renderRow();
    await drag(button, -SHORT_SWIPE);
    await act(async () => button.click());
    expect(open).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
    await act(async () => button.click());
    expect(open).toHaveBeenCalledOnce();
  });

  it("closes an open row when the user turns elsewhere", async () => {
    const { button, actionLabel } = await renderRow();
    await drag(button, -SHORT_SWIPE);
    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(actionLabel("Hide")).toBeUndefined();
  });

  it("keeps one row open at a time, also for a trackpad swipe", async () => {
    vi.useFakeTimers();
    try {
      const container = await render(
        <>
          {["Bread", "Bike"].map((title) => (
            <SwipeRow
              key={title}
              swipeLeft={{
                icon: "Pause",
                label: `Pause ${title}`,
                tone: "neutral",
                onTrigger: vi.fn(),
              }}
            >
              <ListRow title={title} onPress={vi.fn()} />
            </SwipeRow>
          ))}
        </>,
      );
      const labels = () =>
        [...container.querySelectorAll("*")]
          .filter((element) => element.children.length === 0)
          .map((element) => element.textContent)
          .filter((text) => text?.startsWith("Pause"));
      const [bread, bike] = container.querySelectorAll("button");
      await wheel(
        bread!,
        Array.from({ length: 5 }, () => 20),
      );
      await act(async () => vi.advanceTimersByTime(200));
      expect(labels()).toEqual(["Pause Bread"]);
      await wheel(
        bike!,
        Array.from({ length: 5 }, () => 20),
      );
      await act(async () => vi.advanceTimersByTime(1000));
      expect(labels()).toEqual(["Pause Bike"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("springs back from a nudge and still opens on a press", async () => {
    const { button, hide, pin, open } = await renderRow();
    await drag(button, -(swipeRevealWidth / 2));
    expect(hide).not.toHaveBeenCalled();
    expect(pin).not.toHaveBeenCalled();
    await act(async () => button.click());
    expect(open).toHaveBeenCalledOnce();
  });

  it("follows the pointer at first, then resists, never past 60 % of the row", async () => {
    const { button, travel } = await renderRow();
    // The move that claims the gesture, 20 px in, is where the row starts following.
    await drag(button, -40, false);
    expect(travel()).toBeLessThan(-0.9 * 20);
    await drag(button, -2000, false);
    expect(travel()).toBeLessThan(-0.55 * 360);
    expect(travel()).toBeGreaterThanOrEqual(-0.6 * 360);
  });

  it("opens on a short two-finger trackpad swipe and runs on a long one, once it pauses", async () => {
    vi.useFakeTimers();
    try {
      const { button, hide, pin, actionLabel } = await renderRow();
      await wheel(
        button,
        Array.from({ length: 5 }, () => 20),
      );
      await act(async () => vi.advanceTimersByTime(200));
      expect(hide).not.toHaveBeenCalled();
      expect(actionLabel("Hide")).toBeDefined();
      await wheel(
        button,
        Array.from({ length: 30 }, () => 20),
      );
      expect(hide).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTime(200));
      expect(hide).toHaveBeenCalledOnce();
      expect(pin).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends a trackpad swipe once the fingers lift, ignoring the momentum after", async () => {
    vi.useFakeTimers();
    try {
      const { button, hide } = await renderRow();
      await wheel(button, [20, 60, 100, 100, 80, 60, 40, 20, 10, 5, 2]);
      expect(hide).toHaveBeenCalledOnce();
      await act(async () => vi.advanceTimersByTime(200));
      expect(hide).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves the momentum of a swipe that ran its action to no other row", async () => {
    vi.useFakeTimers();
    try {
      const pin = vi.fn();
      const container = await render(
        <>
          {["Bread", "Bike"].map((title) => (
            <SwipeRow
              key={title}
              swipeRight={{
                icon: "Pin",
                label: `Pin ${title}`,
                tone: "accent",
                onTrigger: () => pin(title),
              }}
            >
              <ListRow title={title} onPress={vi.fn()} />
            </SwipeRow>
          ))}
        </>,
      );
      const [bread, bike] = container.querySelectorAll("button");
      // A quick flick: the fingers lift at the first steps that keep shrinking.
      await wheel(bread!, [-20, -60, -100, -100, -80, -60, -40]);
      expect(pin).toHaveBeenCalledExactlyOnceWith("Bread");
      // The pinned listing moved away and another row came under the pointer, which the momentum now reaches.
      const momentum = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaX: -20,
      });
      await act(async () => {
        bike!.dispatchEvent(momentum);
      });
      await wheel(bike!, [-15, -10, -6, -3, -1]);
      expect(momentum.defaultPrevented).toBe(true);
      await act(async () => vi.advanceTimersByTime(1000));
      expect(pin).toHaveBeenCalledOnce();
      expect(
        [...container.querySelectorAll("*")].some(
          (element) =>
            element.children.length === 0 && element.textContent === "Pin Bike",
        ),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves vertical scrolling to the page", async () => {
    const { button } = await renderRow();
    const scroll = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 30,
    });
    button.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(false);
  });
});
