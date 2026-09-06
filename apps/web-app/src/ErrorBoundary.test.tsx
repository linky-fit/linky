import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const BrokenApp = (): React.ReactElement => {
  throw new Error("original render failure");
};

describe("ErrorBoundary", () => {
  const containers: HTMLDivElement[] = [];

  afterEach(() => {
    for (const container of containers) container.remove();
    containers.length = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the original render error visible and reports the failed commit", async () => {
    vi.stubGlobal("__APP_VERSION__", "test-version");
    vi.stubGlobal("__APP_COMMIT_SHA__", "test-commit");
    const { ErrorBoundary } = await import("./ErrorBoundary");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const container = document.createElement("div");
    containers.push(container);
    document.body.appendChild(container);
    const root = createRoot(container);
    const onError = vi.fn();

    act(() => {
      root.render(
        <ErrorBoundary onError={onError}>
          <BrokenApp />
        </ErrorBoundary>,
      );
    });

    expect(container.textContent).toContain("original render failure");
    expect(container.textContent).toContain("Download diagnostics");
    expect(onError).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
