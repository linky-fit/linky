import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { useCurrentNsec } from "./useCurrentNsec";

const mocks = vi.hoisted(() => ({
  clearStoredPushNsec: vi.fn(),
  getInitialNostrNsec: vi.fn(),
  isNativePlatform: vi.fn(),
  readStoredNostrNsec: vi.fn(),
  setStoredPushNsec: vi.fn(),
}));

vi.mock("../../platform/identitySecrets", () => ({
  readStoredNostrNsec: mocks.readStoredNostrNsec,
}));

vi.mock("../../platform/runtime", () => ({
  isNativePlatform: mocks.isNativePlatform,
}));

vi.mock("../../utils/pushNsecStorage", () => ({
  clearStoredPushNsec: mocks.clearStoredPushNsec,
  setStoredPushNsec: mocks.setStoredPushNsec,
}));

vi.mock("../../utils/storage", () => ({
  getInitialNostrNsec: mocks.getInitialNostrNsec,
}));

const CurrentNsecProbe = () => {
  const { currentNsec, isResolved } = useCurrentNsec();
  return (
    <div>
      {String(isResolved)}:{currentNsec ?? "null"}
    </div>
  );
};

describe("useCurrentNsec", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("waits for native secret storage when its value diverges from localStorage", async () => {
    let resolveNativeRead: (value: string | null) => void = () => undefined;
    const nativeRead = new Promise<string | null>((resolve) => {
      resolveNativeRead = resolve;
    });
    mocks.getInitialNostrNsec.mockReturnValue("nsec1stale");
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.readStoredNostrNsec.mockReturnValue(nativeRead);

    const { container, root } = await renderIntoDocument(<CurrentNsecProbe />);

    expect(container.textContent).toBe("false:nsec1stale");

    await act(async () => {
      resolveNativeRead("nsec1authoritative");
      await nativeRead;
    });

    expect(container.textContent).toBe("true:nsec1authoritative");

    await act(async () => root.unmount());
  });

  it("falls back to the local snapshot when the native read rejects", async () => {
    mocks.getInitialNostrNsec.mockReturnValue("nsec1local");
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.readStoredNostrNsec.mockRejectedValue(new Error("bridge failed"));

    const { container, root } = await renderIntoDocument(<CurrentNsecProbe />);

    expect(container.textContent).toBe("true:nsec1local");

    await act(async () => root.unmount());
  });
});
