import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BootCommitSignal, BootLoadingFallback } from "./BootCommitSignal";

describe("BootCommitSignal", () => {
  const containers: HTMLDivElement[] = [];

  afterEach(() => {
    for (const container of containers) container.remove();
    containers.length = 0;
  });

  it("reports the React commit synchronously", () => {
    const container = document.createElement("div");
    containers.push(container);
    document.body.appendChild(container);
    const root = createRoot(container);
    const onCommit = vi.fn();

    act(() => {
      root.render(<BootCommitSignal onCommit={onCommit} />);
    });

    expect(onCommit).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it("reports when initial local data suspends", () => {
    const container = document.createElement("div");
    containers.push(container);
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSuspend = vi.fn();

    act(() => {
      root.render(<BootLoadingFallback onSuspend={onSuspend} />);
    });

    expect(onSuspend).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Loading");
    act(() => root.unmount());
  });
});
