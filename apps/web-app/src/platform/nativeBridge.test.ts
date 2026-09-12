import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startNativeQrScanStream } from "./nativeBridge";

const runtimeMocks = vi.hoisted(() => ({
  getPlatformTarget: vi.fn(() => "android"),
  isNativePlatform: vi.fn(() => true),
}));

vi.mock("./runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtime")>();
  return {
    ...actual,
    getPlatformTarget: runtimeMocks.getPlatformTarget,
    isNativePlatform: runtimeMocks.isNativePlatform,
  };
});

describe("startNativeQrScanStream", () => {
  const callbacks: FrameRequestCallback[] = [];
  const setScanViewport = vi.fn();
  const startScan = vi.fn();
  const stopScan = vi.fn();

  beforeEach(() => {
    callbacks.length = 0;
    setScanViewport.mockReset();
    startScan.mockReset();
    stopScan.mockReset();

    vi.stubGlobal("LinkyNativeScanner", {
      setScanViewport,
      startScan,
      stopScan,
    });
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        callbacks.push(callback);
        return callbacks.length;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("waits for the scanner controls to lay out before starting Android camera preview", () => {
    const viewport = {
      height: 462,
      left: 0,
      top: 84,
      viewportHeight: 640,
      viewportWidth: 360,
      width: 360,
    };
    const getViewport = vi
      .fn()
      .mockReturnValueOnce(null)
      .mockReturnValue(viewport);

    const handle = startNativeQrScanStream(vi.fn(), getViewport);

    expect(handle).not.toBeNull();
    expect(startScan).not.toHaveBeenCalled();

    callbacks.shift()?.(0);

    expect(startScan).not.toHaveBeenCalled();
    expect(callbacks).toHaveLength(1);

    callbacks.shift()?.(16);

    expect(setScanViewport).toHaveBeenCalledWith(0, 84, 360, 462, 360, 640);
    expect(startScan).toHaveBeenCalledOnce();

    handle?.stop();
    expect(stopScan).toHaveBeenCalledOnce();
  });

  it("resizes the running preview when progress takes space and ignores updates after stopping", () => {
    let height = 462;
    const getViewport = () => ({
      height,
      left: 0,
      top: 84,
      viewportHeight: 640,
      viewportWidth: 360,
      width: 360,
    });
    const handle = startNativeQrScanStream(vi.fn(), getViewport);
    handle?.updateViewport();
    expect(setScanViewport).not.toHaveBeenCalled();
    callbacks.shift()?.(0);

    height = 420;
    handle?.updateViewport();
    expect(setScanViewport).toHaveBeenLastCalledWith(0, 84, 360, 420, 360, 640);
    expect(startScan).toHaveBeenCalledOnce();

    handle?.stop();
    setScanViewport.mockClear();
    handle?.updateViewport();
    expect(setScanViewport).not.toHaveBeenCalled();
  });

  it("starts a full-screen preview when the viewport never becomes available", () => {
    const onResult = vi.fn();
    const getViewport = vi.fn(() => null);

    const handle = startNativeQrScanStream(onResult, getViewport);

    expect(handle).not.toBeNull();
    while (callbacks.length > 0) {
      callbacks.shift()?.(0);
    }

    expect(getViewport).toHaveBeenCalledTimes(30);
    expect(setScanViewport).not.toHaveBeenCalled();
    expect(startScan).toHaveBeenCalledOnce();
    expect(onResult).not.toHaveBeenCalled();
  });
});
