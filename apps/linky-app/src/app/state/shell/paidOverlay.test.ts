import { AtomRegistry } from "effect/reactivity";
import { afterEach, describe, expect, it, vi } from "vitest";
import { paidOverlayAtom, paidOverlayCommandsAtom } from "./paidOverlay";

const setup = () => {
  const registry = AtomRegistry.make();
  return {
    commands: registry.get(paidOverlayCommandsAtom),
    overlay: () => registry.get(paidOverlayAtom),
  };
};

const sending = { direction: "out", amountSat: 21 } as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("paid overlay", () => {
  it("closes the sending phase when the payment ends without settling", () => {
    const { commands, overlay } = setup();

    commands.showPaymentSending(sending);
    expect(overlay()?.phase).toBe("sending");

    commands.dismissPaymentSending();
    expect(overlay()).toBeNull();
  });

  it("keeps the settled confirmation up until its timer closes it", () => {
    vi.useFakeTimers();
    const { commands, overlay } = setup();

    commands.showPaymentSending(sending);
    commands.showPaid("paidSent", sending);
    commands.dismissPaymentSending();
    expect(overlay()).toEqual({
      details: sending,
      phase: "done",
      title: "paidSent",
    });

    vi.advanceTimersByTime(2000);
    expect(overlay()).toBeNull();
  });
});
