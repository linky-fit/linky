import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enableInMemoryEvoluStorageForSession,
  prepareEvoluWebStorage,
  shouldUseInMemoryEvoluStorage,
} from "./evoluWebStorage";

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("prepareEvoluWebStorage", () => {
  it("can opt into memory storage after a later database stall", async () => {
    enableInMemoryEvoluStorageForSession();

    expect(shouldUseInMemoryEvoluStorage()).toBe(true);
    expect(sessionStorage.getItem("linky.in_memory_session.v1")).toBe("1");

    const requestInMemoryConsent = vi.fn(() => Promise.resolve());
    await prepareEvoluWebStorage({ requestInMemoryConsent });
    expect(requestInMemoryConsent).not.toHaveBeenCalled();
  });

  it("keeps persistent storage without prompting when OPFS is available", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: () => Promise.resolve({}),
      },
    });
    const requestInMemoryConsent = vi.fn(() => new Promise<void>(() => {}));

    await prepareEvoluWebStorage({ requestInMemoryConsent });

    expect(requestInMemoryConsent).not.toHaveBeenCalled();
    expect(shouldUseInMemoryEvoluStorage()).toBe(false);
  });

  it("asks for consent when OPFS is rejected and remembers the choice", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: () => Promise.reject(new Error("OPFS unavailable")),
      },
    });
    const requestInMemoryConsent = vi.fn(() => Promise.resolve());

    await prepareEvoluWebStorage({ requestInMemoryConsent });

    expect(requestInMemoryConsent).toHaveBeenCalledWith("unavailable");
    expect(shouldUseInMemoryEvoluStorage()).toBe(true);

    // A same-tab reload (e.g. account restore) must not re-prompt.
    const consentAfterReload = vi.fn(() => Promise.resolve());
    await prepareEvoluWebStorage({
      requestInMemoryConsent: consentAfterReload,
    });
    expect(consentAfterReload).not.toHaveBeenCalled();
    expect(shouldUseInMemoryEvoluStorage()).toBe(true);
  });

  it("asks for consent when the probe stalls", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: () => new Promise(() => {}),
      },
    });
    let consent = () => {};
    const requestInMemoryConsent = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          consent = resolve;
        }),
    );

    const preparation = prepareEvoluWebStorage({ requestInMemoryConsent });

    await vi.advanceTimersByTimeAsync(2_999);
    expect(requestInMemoryConsent).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(requestInMemoryConsent).toHaveBeenCalledWith("stalled");

    consent();
    await preparation;
    expect(shouldUseInMemoryEvoluStorage()).toBe(true);
  });

  it("keeps persistent storage when a stalled probe succeeds before consent", async () => {
    vi.useFakeTimers();
    let resolveProbe: (value: unknown) => void = () => {};
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: () =>
          new Promise((resolve) => {
            resolveProbe = resolve;
          }),
      },
    });
    const requestInMemoryConsent = vi.fn(() => new Promise<void>(() => {}));

    const preparation = prepareEvoluWebStorage({ requestInMemoryConsent });

    await vi.advanceTimersByTimeAsync(3_000);
    expect(requestInMemoryConsent).toHaveBeenCalledWith("stalled");

    resolveProbe({});
    await preparation;
    expect(shouldUseInMemoryEvoluStorage()).toBe(false);
  });
});
