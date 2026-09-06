import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { navigateTo } from "../../../hooks/useRouting";
import { mainSwipeProgressStore } from "../../lib/mainSwipeProgressStore";
import {
  alignMainSwipeToTarget,
  getMainSwipeTargetForProgress,
  shouldDisableWalletReturnAnimation,
  useMainSwipeNavigation,
} from "./useMainSwipeNavigation";

vi.mock("../../../hooks/useRouting", () => ({
  navigateTo: vi.fn(),
}));

interface MockMainSwipeElement {
  clientWidth: number;
  scrollToCalls: Array<{ behavior: ScrollBehavior; left: number }>;
  scrollLeft: number;
  scrollTo: (options: { behavior: ScrollBehavior; left: number }) => void;
}

const createElement = (
  clientWidth: number,
  scrollLeft: number,
): MockMainSwipeElement => {
  const scrollToCalls: Array<{ behavior: ScrollBehavior; left: number }> = [];

  return {
    clientWidth,
    scrollLeft,
    scrollToCalls,
    scrollTo: (options) => {
      scrollToCalls.push(options);
    },
  };
};

const SwipeHarness = (): React.ReactElement => {
  const mainSwipeRef = React.useRef<HTMLDivElement | null>(null);
  const mainSwipeScrollTimerRef = React.useRef<number | null>(null);
  useMainSwipeNavigation({
    isMainSwipeRoute: true,
    mainSwipeRef,
    mainSwipeScrollTimerRef,
    routeKind: "contacts",
  });

  return <div ref={mainSwipeRef} />;
};

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("alignMainSwipeToTarget", () => {
  it("snaps contacts back to the exact left edge", () => {
    const element = createElement(390, 0.4);

    alignMainSwipeToTarget(element, "contacts");

    expect(element.scrollToCalls).toEqual([
      {
        behavior: "auto",
        left: 0,
      },
    ]);
  });

  it("snaps wallet back to the exact right edge", () => {
    const element = createElement(390, 389.4);

    alignMainSwipeToTarget(element, "wallet");

    expect(element.scrollToCalls).toEqual([
      {
        behavior: "auto",
        left: 390,
      },
    ]);
  });

  it("does nothing when already aligned", () => {
    const element = createElement(390, 390);

    alignMainSwipeToTarget(element, "wallet");

    expect(element.scrollToCalls).toEqual([]);
  });

  it("waits to align the wallet until the swipe has a measured width", () => {
    const element = createElement(0, 0);

    alignMainSwipeToTarget(element, "wallet");

    expect(element.scrollToCalls).toEqual([]);
  });
});

describe("shouldDisableWalletReturnAnimation", () => {
  it("allows the wallet slide only when moving from contacts", () => {
    expect(shouldDisableWalletReturnAnimation("wallet", "contacts")).toBe(
      false,
    );
  });

  it("disables the wallet slide when returning from another page", () => {
    expect(shouldDisableWalletReturnAnimation("wallet", "cashuTokens")).toBe(
      true,
    );
    expect(shouldDisableWalletReturnAnimation("wallet", "profile")).toBe(true);
    expect(shouldDisableWalletReturnAnimation("wallet", "wallet")).toBe(true);
  });

  it("does not affect contacts alignment", () => {
    expect(shouldDisableWalletReturnAnimation("contacts", "wallet")).toBe(
      false,
    );
  });
});

describe("getMainSwipeTargetForProgress", () => {
  it("keeps contacts through the halfway point", () => {
    expect(getMainSwipeTargetForProgress(0)).toBe("contacts");
    expect(getMainSwipeTargetForProgress(0.5)).toBe("contacts");
  });

  it("selects wallet after the halfway point", () => {
    expect(getMainSwipeTargetForProgress(0.51)).toBe("wallet");
    expect(getMainSwipeTargetForProgress(1)).toBe("wallet");
  });
});

describe("native swipe settling", () => {
  it("does not seize the swipe while the finger is still down", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<SwipeHarness />);
    });
    await act(async () => {
      vi.advanceTimersByTime(20);
    });

    const swipe = container.firstElementChild;
    expect(swipe).toBeInstanceOf(HTMLDivElement);
    if (!(swipe instanceof HTMLDivElement)) return;

    Object.defineProperty(swipe, "clientWidth", {
      configurable: true,
      value: 390,
    });
    const progressListener = vi.fn();
    const unsubscribe = mainSwipeProgressStore.subscribe(progressListener);
    swipe.dispatchEvent(new Event("touchstart", { bubbles: true }));
    swipe.scrollLeft = 250;
    swipe.dispatchEvent(new Event("scroll", { bubbles: true }));
    expect(mainSwipeProgressStore.get().progress).toBe(0);
    expect(progressListener).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(navigateTo).not.toHaveBeenCalled();

    swipe.dispatchEvent(new Event("touchend", { bubbles: true }));
    swipe.dispatchEvent(new Event("scrollend", { bubbles: true }));
    expect(navigateTo).toHaveBeenCalledWith({ route: "wallet" });
    unsubscribe();

    await act(async () => {
      root.unmount();
    });
  });

  it("uses the delayed fallback when scrollend is unavailable", async () => {
    vi.useFakeTimers();
    const scrollEndDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "onscrollend",
    );
    Reflect.deleteProperty(HTMLElement.prototype, "onscrollend");
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<SwipeHarness />);
    });
    await act(async () => {
      vi.advanceTimersByTime(20);
    });

    const swipe = container.firstElementChild;
    expect(swipe).toBeInstanceOf(HTMLDivElement);
    if (!(swipe instanceof HTMLDivElement)) return;

    Object.defineProperty(swipe, "clientWidth", {
      configurable: true,
      value: 390,
    });
    swipe.dispatchEvent(new Event("touchstart", { bubbles: true }));
    swipe.scrollLeft = 250;
    swipe.dispatchEvent(new Event("scroll", { bubbles: true }));
    swipe.dispatchEvent(new Event("touchend", { bubbles: true }));

    await act(async () => {
      vi.advanceTimersByTime(239);
    });
    expect(navigateTo).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(navigateTo).toHaveBeenCalledWith({ route: "wallet" });

    await act(async () => {
      root.unmount();
    });
    if (scrollEndDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "onscrollend",
        scrollEndDescriptor,
      );
    }
  });
});
