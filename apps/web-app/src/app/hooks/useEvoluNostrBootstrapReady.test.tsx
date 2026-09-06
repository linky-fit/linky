import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { useEvoluNostrBootstrapReady } from "./useEvoluNostrBootstrapReady";

interface HarnessProps {
  identityReady?: boolean;
  messagesSnapshot?: ReadonlyArray<object>;
  onReady: (ready: boolean) => void;
}

const EMPTY_SNAPSHOT: ReadonlyArray<object> = [];

const Harness = ({
  identityReady = true,
  messagesSnapshot = EMPTY_SNAPSHOT,
  onReady,
}: HarnessProps): null => {
  const ready = useEvoluNostrBootstrapReady({
    contactsSnapshot: EMPTY_SNAPSHOT,
    enabled: true,
    identitiesSnapshot: EMPTY_SNAPSHOT,
    identityReady,
    maxWaitMs: 800,
    messagesSnapshot,
    minWaitMs: 250,
    ownerKey: "owners-ready",
    quietWindowMs: 50,
    reactionsSnapshot: EMPTY_SNAPSHOT,
    tokensSnapshot: EMPTY_SNAPSHOT,
    transactionsSnapshot: EMPTY_SNAPSHOT,
  });
  onReady(ready);
  return null;
};

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

describe("useEvoluNostrBootstrapReady", () => {
  it("waits for the minimum Evolu bootstrap window", async () => {
    vi.useFakeTimers();
    let ready = false;

    const { root } = await renderIntoDocument(
      <Harness onReady={(value) => (ready = value)} />,
    );
    expect(ready).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(ready).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(ready).toBe(true);

    await act(async () => root.unmount());
  });

  it("restarts the quiet window when an Evolu snapshot changes", async () => {
    vi.useFakeTimers();
    let ready = false;
    const onReady = (value: boolean) => (ready = value);

    const { root } = await renderIntoDocument(<Harness onReady={onReady} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240);
    });
    await act(async () => {
      root.render(
        <Harness messagesSnapshot={[{ id: "synced" }]} onReady={onReady} />,
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(49);
    });
    expect(ready).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(ready).toBe(true);

    await act(async () => root.unmount());
  });

  it("does not release while an identity migration is pending", async () => {
    vi.useFakeTimers();
    let ready = false;
    const onReady = (value: boolean) => (ready = value);

    const { root } = await renderIntoDocument(
      <Harness identityReady={false} onReady={onReady} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(ready).toBe(false);

    await act(async () => {
      root.render(<Harness identityReady onReady={onReady} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(49);
    });
    expect(ready).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(ready).toBe(true);

    await act(async () => root.unmount());
  });

  it("restarts Evolu bootstrap after coming online", async () => {
    vi.useFakeTimers();
    let ready = false;

    const { root } = await renderIntoDocument(
      <Harness onReady={(value) => (ready = value)} />,
    );
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(ready).toBe(false);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(ready).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(ready).toBe(true);

    await act(async () => root.unmount());
  });
});
