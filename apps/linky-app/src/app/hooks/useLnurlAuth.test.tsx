import { act, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import type { LnurlAuthPreview } from "../../lnurlAuth";

const { submitLnurlAuthMock } = vi.hoisted(() => ({
  submitLnurlAuthMock: vi.fn<() => Promise<void>>(),
}));

vi.mock("../../lnurlAuth", () => ({
  submitLnurlAuth: submitLnurlAuthMock,
}));

import { useLnurlAuth, type LnurlAuthResult } from "./useLnurlAuth";

const PREVIEW: LnurlAuthPreview = {
  action: "register",
  domain: "example.com",
  k1: "a".repeat(64),
  requestUrl: `https://example.com/auth?tag=login&k1=${"a".repeat(64)}`,
};

const t = (key: string) => key;

describe("useLnurlAuth", () => {
  const latest: { current: LnurlAuthResult | null } = { current: null };
  const setStatus = vi.fn();

  function Harness(): null {
    const result = useLnurlAuth({ currentNsec: "nsec1test", setStatus, t });
    useEffect(() => {
      latest.current = result;
    });
    return null;
  }

  const confirm = async () => {
    await act(async () => {
      latest.current?.requestLnurlAuthConfirmation(PREVIEW);
    });
    await act(async () => {
      await latest.current?.confirmLnurlAuth();
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    latest.current = null;
  });

  it("keeps the sheet in its done state instead of a toast and closes it on a timer", async () => {
    submitLnurlAuthMock.mockResolvedValue(undefined);
    const rendered = await renderIntoDocument(<Harness />);

    await confirm();

    expect(latest.current?.pendingLnurlAuthConfirmation).toEqual(PREVIEW);
    expect(latest.current?.lnurlAuthIsDone).toBe(true);
    expect(setStatus).not.toHaveBeenCalled();

    await act(async () => {
      latest.current?.closeLnurlAuthConfirmation();
    });
    expect(latest.current?.pendingLnurlAuthConfirmation).toEqual(PREVIEW);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2400);
    });
    expect(latest.current?.lnurlAuthIsDone).toBe(false);
    expect(latest.current?.pendingLnurlAuthConfirmation).toBeNull();

    await rendered.unmount();
  });

  it("reports a rejected login through the status toast and keeps the sheet", async () => {
    submitLnurlAuthMock.mockRejectedValue(new Error("k1 already used"));
    const rendered = await renderIntoDocument(<Harness />);

    await confirm();

    expect(latest.current?.lnurlAuthIsDone).toBe(false);
    expect(latest.current?.pendingLnurlAuthConfirmation).toEqual(PREVIEW);
    expect(setStatus).toHaveBeenCalledWith("errorPrefix: k1 already used");

    await rendered.unmount();
  });
});
