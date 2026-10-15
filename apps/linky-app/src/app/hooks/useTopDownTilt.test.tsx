import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import {
  gravityYToElevationDeg,
  nextTopDownState,
  useTopDownTilt,
} from "./useTopDownTilt";

const Harness = ({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (topDown: boolean) => void;
}): null => {
  useTopDownTilt({ enabled, onChange });
  return null;
};

const dispatchMotion = (gravityY: number) => {
  const event = new Event("devicemotion");
  Object.defineProperty(event, "accelerationIncludingGravity", {
    value: { x: 0, y: gravityY, z: 0 },
  });
  window.dispatchEvent(event);
};

const dispatchOrientation = (beta: number) => {
  const event = new Event("deviceorientation");
  Object.defineProperty(event, "beta", { value: beta });
  window.dispatchEvent(event);
};

describe("top-down tilt detection", () => {
  it("maps gravity along the screen axis to the top edge elevation", () => {
    expect(gravityYToElevationDeg(9.81)).toBeCloseTo(90);
    expect(gravityYToElevationDeg(0)).toBeCloseTo(0);
    expect(gravityYToElevationDeg(-9.81)).toBeCloseTo(-90);
    expect(gravityYToElevationDeg(-20)).toBeCloseTo(-90);
  });

  it("enters only past the deep threshold and leaves near horizontal", () => {
    expect(nextTopDownState(false, -30)).toBe(false);
    expect(nextTopDownState(false, -40)).toBe(true);
    expect(nextTopDownState(true, -20)).toBe(true);
    expect(nextTopDownState(true, -10)).toBe(false);
  });

  it("reports each transition once from motion or orientation events", async () => {
    const onChange = vi.fn();
    const rendered = await renderIntoDocument(
      <Harness enabled onChange={onChange} />,
    );

    act(() => {
      dispatchMotion(9); // upright
      dispatchMotion(-8); // flipped
      dispatchMotion(-8.5); // still flipped
      dispatchOrientation(-60); // orientation agrees
    });
    expect(onChange.mock.calls).toEqual([[true]]);

    act(() => {
      dispatchOrientation(-5);
    });
    expect(onChange.mock.calls).toEqual([[true], [false]]);

    await rendered.unmount();
  });

  it("listens without requesting motion permission", async () => {
    const requestPermission = vi
      .fn<() => Promise<PermissionState>>()
      .mockRejectedValue(new Error("needs a user gesture"));
    vi.stubGlobal("DeviceMotionEvent", { requestPermission });
    const onChange = vi.fn();
    const rendered = await renderIntoDocument(
      <Harness enabled onChange={onChange} />,
    );
    await act(async () => {});
    act(() => {
      dispatchMotion(-9);
    });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(onChange.mock.calls).toEqual([[true]]);

    vi.unstubAllGlobals();
    await rendered.unmount();
  });

  it("ignores events while disabled and clears an open tilt on disable", async () => {
    const onChange = vi.fn();
    const rendered = await renderIntoDocument(
      <Harness enabled={false} onChange={onChange} />,
    );
    act(() => {
      dispatchMotion(-9);
    });
    expect(onChange).not.toHaveBeenCalled();

    await rendered.rerender(<Harness enabled onChange={onChange} />);
    act(() => {
      dispatchMotion(-9);
    });
    await rendered.rerender(<Harness enabled={false} onChange={onChange} />);
    expect(onChange.mock.calls).toEqual([[true], [false]]);

    await rendered.unmount();
  });
});
