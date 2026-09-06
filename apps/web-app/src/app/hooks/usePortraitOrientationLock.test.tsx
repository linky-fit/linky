import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { usePortraitOrientationLock } from "./usePortraitOrientationLock";

interface HarnessProps {
  enabled: boolean;
}

const Harness = ({ enabled }: HarnessProps): null => {
  usePortraitOrientationLock(enabled);
  return null;
};

describe("portrait orientation lock preference", () => {
  it("requests the lock only after opt-in", async () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    const originalOrientation = Object.getOwnPropertyDescriptor(
      window.screen,
      "orientation",
    );
    Object.defineProperty(window.screen, "orientation", {
      configurable: true,
      value: { lock },
    });

    const { root } = await renderIntoDocument(<Harness enabled={false} />);
    expect(lock).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<Harness enabled />);
    });
    expect(lock).toHaveBeenCalledWith("portrait-primary");

    await act(async () => {
      root.unmount();
    });
    if (originalOrientation) {
      Object.defineProperty(window.screen, "orientation", originalOrientation);
    } else {
      Reflect.deleteProperty(window.screen, "orientation");
    }
  });
});
