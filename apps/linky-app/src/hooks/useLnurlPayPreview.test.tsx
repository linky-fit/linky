import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLnurlPayAmountRangeError,
  useLnurlPayPreview,
  type LnurlPayPreviewResult,
} from "./useLnurlPayPreview";
import type { LnurlPayPreview } from "../lnurlPay";

const renderPreviewHook = (target: string) => {
  const results: LnurlPayPreviewResult[] = [];
  const Harness: React.FC<{ target: string }> = ({ target: harnessTarget }) => {
    results.push(useLnurlPayPreview(harnessTarget));
    return null;
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(<Harness target={target} />);
  });
  return {
    latest: () => results[results.length - 1],
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
};

const flushMicrotasks = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const mockPayRequestResponse = (minSendable: number, maxSendable: number) => {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        callback: "https://lnbits.cz/lnurlp/api/v1/lnurl/cb/KfCp5v",
        maxSendable,
        metadata: '[["text/plain", "Fixed price"]]',
        minSendable,
        tag: "payRequest",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    ),
  );
};

describe("useLnurlPayPreview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays idle for an empty target", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const hook = renderPreviewHook("");
    await flushMicrotasks();

    expect(hook.latest()).toMatchObject({
      error: null,
      fixedAmountSat: null,
      loading: false,
      preview: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("reports a fixed amount when minSendable equals maxSendable", async () => {
    mockPayRequestResponse(4352000, 4352000);
    const hook = renderPreviewHook("fixed@lnbits.cz");
    expect(hook.latest().loading).toBe(true);

    await flushMicrotasks();

    expect(hook.latest()).toMatchObject({
      error: null,
      fixedAmountSat: 4352,
      loading: false,
    });
    hook.unmount();
  });

  it("reports no fixed amount for a min/max range", async () => {
    mockPayRequestResponse(1000, 10000000000);
    const hook = renderPreviewHook("plex@21m.lol");
    await flushMicrotasks();

    expect(hook.latest()).toMatchObject({
      error: null,
      fixedAmountSat: null,
      loading: false,
    });
    expect(hook.latest().preview).toMatchObject({
      maxSendableSat: 10000000,
      minSendableSat: 1,
    });
    hook.unmount();
  });

  it("surfaces the server error reason", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ERROR",
          reason: "Lightning address not found.",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    const hook = renderPreviewHook("missing@21m.lol");
    await flushMicrotasks();

    expect(hook.latest()).toMatchObject({
      error: "Lightning address not found.",
      loading: false,
      preview: null,
    });
    hook.unmount();
  });
});

describe("getLnurlPayAmountRangeError", () => {
  const t = (key: string) => key;
  const preview: LnurlPayPreview = {
    callback: "https://lnbits.cz/lnurlp/api/v1/lnurl/cb/KfCp5v",
    commentAllowed: 0,
    description: null,
    lightningAddress: null,
    maxSendableMsat: 100000,
    maxSendableSat: 100,
    metadataRaw: null,
    minSendableMsat: 10000,
    minSendableSat: 10,
    target: "lnbits.cz",
  };

  it("accepts an amount within range", () => {
    expect(getLnurlPayAmountRangeError(preview, 50, t)).toBeNull();
  });

  it("rejects an amount below the minimum", () => {
    expect(getLnurlPayAmountRangeError(preview, 5, t)).toBe(
      "lnurlPayAmountTooLow",
    );
  });

  it("rejects an amount above the maximum", () => {
    expect(getLnurlPayAmountRangeError(preview, 500, t)).toBe(
      "lnurlPayAmountTooHigh",
    );
  });

  it("ignores an empty or unloaded amount", () => {
    expect(getLnurlPayAmountRangeError(preview, Number.NaN, t)).toBeNull();
    expect(getLnurlPayAmountRangeError(null, 5, t)).toBeNull();
  });
});
