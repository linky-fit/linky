import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { usePaidOverlayState } from "./usePaidOverlayState";

type OverlayState = ReturnType<typeof usePaidOverlayState>;

const setup = async () => {
  const stateRef: { current: OverlayState | null } = { current: null };
  const Harness = () => {
    const state = usePaidOverlayState({ t: (key) => key });
    React.useEffect(() => {
      stateRef.current = state;
    }, [state]);
    return null;
  };
  const rendered = await renderIntoDocument(<Harness />);
  const state = (): OverlayState => {
    if (stateRef.current === null) throw new Error("hook did not mount");
    return stateRef.current;
  };
  return { rendered, state };
};

const sending = { direction: "out", amountSat: 21 } as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("usePaidOverlayState", () => {
  it("closes the sending phase when the payment ends without settling", async () => {
    const { rendered, state } = await setup();

    await act(async () => state().showPaymentSending(sending));
    expect(state().paidOverlayIsOpen).toBe(true);
    expect(state().paidOverlayPhase).toBe("sending");

    await act(async () => state().dismissPaymentSending());
    expect(state().paidOverlayIsOpen).toBe(false);

    await rendered.unmount();
  });

  it("keeps the settled confirmation up until its timer closes it", async () => {
    vi.useFakeTimers();
    const { rendered, state } = await setup();

    await act(async () => {
      state().showPaymentSending(sending);
      state().showPaidOverlay("paidSent", sending);
      state().dismissPaymentSending();
    });
    expect(state().paidOverlayIsOpen).toBe(true);
    expect(state().paidOverlayPhase).toBe("done");
    expect(state().paidOverlayTitle).toBe("paidSent");

    await act(async () => vi.advanceTimersByTime(2000));
    expect(state().paidOverlayIsOpen).toBe(false);

    await rendered.unmount();
  });
});
