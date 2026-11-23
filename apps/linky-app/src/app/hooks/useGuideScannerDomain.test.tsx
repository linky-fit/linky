import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import { act } from "react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import type { Translate } from "../../i18n";
import type { PlatformTarget } from "../../platform/runtime";
import { createAnimatedQrFrames } from "../../utils/animatedQr";
import {
  scanDiagnosticsAtom,
  scanIsOpenAtom,
  scanPausedAtom,
} from "../state/shell/scan";
import { useGuideScannerDomain } from "./useGuideScannerDomain";

interface NativeScanResult {
  cancelled: boolean;
  message?: string;
  value: string | null;
}

interface NativeState {
  onResult: ((result: NativeScanResult) => void) | null;
  oneShot: Promise<NativeScanResult> | null;
  stop: ReturnType<typeof vi.fn>;
}

const native = vi.hoisted(
  (): NativeState => ({
    onResult: null,
    oneShot: null,
    stop: vi.fn(),
  }),
);

vi.mock("../../platform/nativeBridge", () => ({
  startNativeQrScan: () => native.oneShot,
  startNativeQrScanStream: (onResult: (result: NativeScanResult) => void) => {
    if (native.oneShot) return null;
    native.onResult = onResult;
    return { stop: native.stop };
  },
  supportsNativeQrScan: () => true,
}));
const platform = vi.hoisted((): { target: PlatformTarget } => ({
  target: "android",
}));
vi.mock("../../platform/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../platform/runtime")>()),
  getPlatformTarget: () => platform.target,
}));
const animatedQrGate = vi.hoisted((): { wait: Promise<void> | null } => ({
  wait: null,
}));
vi.mock("../../utils/animatedQr", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../utils/animatedQr")>();
  return {
    ...actual,
    createAnimatedQrReader: async () => {
      if (animatedQrGate.wait) await animatedQrGate.wait;
      return actual.createAnimatedQrReader();
    },
  };
});
// The walkthrough reads the beacon, whose store needs the whole native bridge.
vi.mock("./useBeacon", () => ({
  useBeacon: () => ({ enabled: false }),
  useBeaconSupport: () => false,
}));

const token = `cashuB${"o2FtcGh0dHBzOi8vY2FzaHUuY3phdWNzYXRhdIGiYWlIAbqH8lOtAF9hcI".repeat(40)}`;
const translateToKey: Translate = (key) => key;

type Scanner = ReturnType<typeof useGuideScannerDomain>;

const setup = async () => {
  const onScannedText = vi.fn<(text: string) => Promise<void>>(
    async () => undefined,
  );
  const pushToast = vi.fn<(message: string) => void>();
  const scannerRef: { current: Scanner | null } = { current: null };

  const Probe = (): null => {
    const scanner = useGuideScannerDomain({
      cashuBalance: 0,
      contacts: [],
      contactsOnboardingHasBackedUpKeys: true,
      contactsOnboardingHasPaid: true,
      contactsOnboardingHasSentMessage: true,
      contactsOnboardingHasSupported: true,
      onScannedText,
      openNewContactPage: () => undefined,
      pushToast,
      route: { kind: "contacts" },
      t: translateToKey,
    });
    React.useEffect(() => {
      scannerRef.current = scanner;
    }, [scanner]);
    return null;
  };

  const registry = AtomRegistry.make();
  const rendered = await renderIntoDocument(
    <RegistryContext.Provider value={registry}>
      <Probe />
    </RegistryContext.Provider>,
  );
  await act(async () => {
    scannerRef.current?.openReceiveScan();
  });
  // The stream starts once the viewport has been measured, a frame later.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return { onScannedText, pushToast, registry, rendered, scannerRef };
};

const deliver = async (value: string) => {
  await act(async () => {
    native.onResult?.({ cancelled: false, value });
  });
};

describe("native scanner stream", () => {
  afterEach(() => {
    animatedQrGate.wait = null;
    native.onResult = null;
    native.oneShot = null;
    native.stop.mockReset();
  });

  it("collects animated QR frames and stops once the token is complete", async () => {
    const { onScannedText, pushToast, registry, rendered } = await setup();
    expect(native.onResult).not.toBeNull();

    const frames = await createAnimatedQrFrames(token);
    for (
      let i = 0;
      i < frames.total * 4 && !onScannedText.mock.calls.length;
      i += 1
    ) {
      await deliver(frames.next());
    }

    expect(onScannedText).toHaveBeenCalledTimes(1);
    expect(onScannedText).toHaveBeenCalledWith(token);
    expect(native.stop).toHaveBeenCalledTimes(1);
    expect(pushToast).not.toHaveBeenCalled();
    expect(registry.get(scanDiagnosticsAtom).animation).toBeNull();
    await rendered.unmount();
  });

  it("hands a plain code on after stopping the stream", async () => {
    const { onScannedText, rendered } = await setup();
    await deliver("lnbc1example");

    expect(native.stop).toHaveBeenCalledTimes(1);
    expect(onScannedText).toHaveBeenCalledWith("lnbc1example");
    await rendered.unmount();
  });

  it("tells a one-shot scanner that a frame is not a payload", async () => {
    const frames = await createAnimatedQrFrames(token);
    native.oneShot = Promise.resolve({
      cancelled: false,
      value: frames.next(),
    });
    const { onScannedText, pushToast, registry, rendered } = await setup();

    expect(pushToast).toHaveBeenCalledWith("scanAnimatedQrNeedsCamera");
    expect(onScannedText).not.toHaveBeenCalled();
    expect(registry.get(scanIsOpenAtom)).toBe(false);
    await rendered.unmount();
  });

  it.each([
    ["android", "scanPermissionDeniedAndroid"],
    ["ios", "scanPermissionDeniedIos"],
  ] as const)(
    "points a denied camera on %s to the system settings",
    async (target, message) => {
      platform.target = target;
      const { pushToast, rendered } = await setup();
      await act(async () => {
        native.onResult?.({
          cancelled: false,
          message: "Camera permission denied",
          value: null,
        });
      });

      expect(pushToast).toHaveBeenCalledWith(message);
      await rendered.unmount();
    },
  );

  it("discards native detections while paused and resumes when unpaused", async () => {
    const { onScannedText, registry, rendered } = await setup();

    await act(async () => {
      registry.set(scanPausedAtom, true);
    });
    await deliver("lnbc1ignored");

    expect(onScannedText).not.toHaveBeenCalled();
    expect(native.stop).not.toHaveBeenCalled();
    expect(registry.get(scanIsOpenAtom)).toBe(true);

    await act(async () => {
      registry.set(scanPausedAtom, false);
    });
    await deliver("lnbc1accepted");

    expect(native.stop).toHaveBeenCalledTimes(1);
    expect(onScannedText).toHaveBeenCalledWith("lnbc1accepted");
    await rendered.unmount();
  });

  it("drops an in-flight animated QR read when paused and resumed before its decoder loads", async () => {
    let releaseDecoder: (() => void) | null = null;
    animatedQrGate.wait = new Promise<void>((resolve) => {
      releaseDecoder = resolve;
    });

    const { onScannedText, registry, rendered } = await setup();
    const frames = await createAnimatedQrFrames(token);

    // Deliver the first frame while the decoder load is still pending.
    await deliver(frames.next());
    expect(registry.get(scanDiagnosticsAtom).animation).toEqual({
      expected: null,
      received: 0,
    });

    // Pause (More opens) and resume (More closes) before the decoder resolves.
    await act(async () => {
      registry.set(scanPausedAtom, true);
    });
    expect(registry.get(scanDiagnosticsAtom).animation).toBeNull();
    await act(async () => {
      registry.set(scanPausedAtom, false);
    });

    await act(async () => {
      releaseDecoder?.();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(registry.get(scanDiagnosticsAtom).animation).toBeNull();
    expect(onScannedText).not.toHaveBeenCalled();
    await rendered.unmount();
  });
});
