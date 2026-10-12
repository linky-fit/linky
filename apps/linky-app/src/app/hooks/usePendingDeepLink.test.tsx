import { act, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { readPendingDeepLinks } from "../lib/pendingDeepLinks";
import { usePendingDeepLink } from "./usePendingDeepLink";

const first = "cashu:cashuAfirst";
const second = "cashu:cashuAsecond";

/** A handler whose calls finish only when the test says so. */
const controlledHandle = () => {
  const finishers: Array<() => void> = [];
  const handle = vi.fn(
    () => new Promise<void>((resolve) => finishers.push(resolve)),
  );
  return {
    handle,
    finishNext: async () => act(async () => finishers.shift()?.()),
  };
};

const renderPendingLink = async (
  handle: (text: string) => Promise<void>,
  ready: boolean,
) => {
  const enqueuers: Array<(text: string) => void> = [];
  const Probe = ({ isReady }: { isReady: boolean }) => {
    const enqueue = usePendingDeepLink({ handle, ready: isReady });
    useEffect(() => {
      enqueuers.push(enqueue);
    }, [enqueue]);
    return null;
  };
  const rendered = await renderIntoDocument(<Probe isReady={ready} />);
  return {
    push: async (text: string) => act(async () => enqueuers.at(-1)?.(text)),
    setReady: async (isReady: boolean) =>
      rendered.rerender(<Probe isReady={isReady} />),
    unmount: rendered.unmount,
  };
};

afterEach(() => localStorage.clear());

describe("usePendingDeepLink", () => {
  it("holds links until the app is ready, then handles them one at a time in order", async () => {
    const { handle, finishNext } = controlledHandle();
    const view = await renderPendingLink(handle, false);
    await view.push(first);
    await view.push(second);
    expect(handle).not.toHaveBeenCalled();

    await view.setReady(true);
    expect(handle.mock.calls).toEqual([[first]]);

    await finishNext();
    expect(handle.mock.calls).toEqual([[first], [second]]);
    await finishNext();
    expect(readPendingDeepLinks()).toEqual([]);
  });

  it("keeps every link stored until it is handled, so a reload mid-queue loses none", async () => {
    const before = controlledHandle();
    const view = await renderPendingLink(before.handle, true);
    await view.push(first);
    await view.push(second);
    expect(before.handle).toHaveBeenCalledOnce();

    // The page reloads while the first link is still being handled.
    await view.unmount();
    expect(readPendingDeepLinks()).toEqual([first, second]);

    const after = controlledHandle();
    await renderPendingLink(after.handle, true);
    await after.finishNext();
    await after.finishNext();
    expect(after.handle.mock.calls).toEqual([[first], [second]]);
    expect(readPendingDeepLinks()).toEqual([]);
  });

  it("drops a link whose handling throws instead of retrying it", async () => {
    const handle = vi.fn(async () => {
      throw new Error("not a link we can use");
    });
    const view = await renderPendingLink(handle, true);

    await view.push(first);

    await vi.waitFor(() => expect(readPendingDeepLinks()).toEqual([]));
    expect(handle).toHaveBeenCalledOnce();
  });
});
