import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "./testUtils/renderIntoDocument";

const database = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  listeners: new Set<() => void>(),
  errorListeners: new Set<() => void>(),
  getError: vi.fn<() => unknown>(),
  loadQuery:
    vi.fn<(table: string) => Promise<ReadonlyArray<{ count: number }>>>(),
}));

vi.mock("@evolu/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@evolu/common")>()),
  createEvolu: () => () => ({
    createQuery: (
      build: (db: {
        selectFrom: (table: string) => { select: () => string };
      }) => string,
    ) => build({ selectFrom: (table) => ({ select: () => table }) }),
    loadQuery: database.loadQuery,
    getError: database.getError,
    subscribeError: (listener: () => void) => {
      database.errorListeners.add(listener);
      return () => database.errorListeners.delete(listener);
    },
    subscribeQuery: () => (listener: () => void) => {
      database.listeners.add(listener);
      return () => database.listeners.delete(listener);
    },
  }),
}));

import { useEvoluDatabaseInfoState } from "./evolu";

type DatabaseState = ReturnType<typeof useEvoluDatabaseInfoState>;

interface HarnessProps {
  onState: (state: DatabaseState) => void;
  enabled?: boolean;
}

const Harness = ({ onState, enabled = true }: HarnessProps) => {
  onState(useEvoluDatabaseInfoState({ enabled }));
  return null;
};

const notifyMutation = () => {
  for (const listener of database.listeners) listener();
};

beforeEach(() => {
  database.counts.clear();
  database.listeners.clear();
  database.errorListeners.clear();
  database.getError.mockReset().mockReturnValue(undefined);
  database.loadQuery
    .mockReset()
    .mockImplementation(async (table) => [
      { count: database.counts.get(table) ?? 0 },
    ]);
});

describe("Evolu database diagnostics", () => {
  it("keeps local counts live after an unrelated transport exception", async () => {
    let state: DatabaseState | undefined;
    const view = await renderIntoDocument(
      <Harness
        onState={(value) => {
          state = value;
        }}
      />,
    );
    await act(async () => {
      database.getError.mockReturnValue({
        type: "TransferableError",
        error: "transport failed",
      });
      for (const listener of database.errorListeners) listener();
      database.counts.set("contact", 7);
      notifyMutation();
    });
    expect(state?.info.tableCounts.contact).toBe(7);
    expect(state?.isBusy).toBe(false);
    await view.unmount();
  });

  it("updates the boot snapshot when rows arrive later over sync", async () => {
    let state: DatabaseState | undefined;
    const view = await renderIntoDocument(
      <Harness onState={(value) => (state = value)} />,
    );
    expect(state?.info.tableCounts.contact).toBe(0);
    expect(state?.info.historyCount).toBe(0);

    await act(async () => {
      database.counts.set("contact", 7);
      database.counts.set("evolu_history", 870);
      notifyMutation();
    });

    expect(state?.info.tableCounts.contact).toBe(7);
    expect(state?.info.historyCount).toBe(870);
    await view.unmount();
    expect(database.listeners.size).toBe(0);
  });

  it("reloads a mutation received while the previous snapshot is loading", async () => {
    let release: (() => void) | undefined;
    database.loadQuery.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([{ count: 0 }]);
        }),
    );
    let state: DatabaseState | undefined;
    const view = await renderIntoDocument(
      <Harness onState={(value) => (state = value)} />,
    );
    expect(state?.isBusy).toBe(true);

    await act(async () => {
      database.counts.set("contact", 7);
      database.counts.set("evolu_history", 870);
      notifyMutation();
      release?.();
    });

    expect(state?.info.tableCounts.contact).toBe(7);
    expect(state?.info.historyCount).toBe(870);
    expect(state?.isBusy).toBe(false);
    await view.unmount();
  });

  it("keeps failed counts unknown instead of reporting an empty database", async () => {
    database.loadQuery.mockRejectedValue(new Error("Database unavailable"));
    let state: DatabaseState | undefined;
    const view = await renderIntoDocument(
      <Harness onState={(value) => (state = value)} />,
    );
    expect(state?.info.tableCounts.contact).toBeNull();
    expect(state?.info.historyCount).toBeNull();
    await view.unmount();
  });

  it("does no diagnostic work off-route and refreshes on entry", async () => {
    let state: DatabaseState | undefined;
    const onState = (value: DatabaseState) => {
      state = value;
    };
    const view = await renderIntoDocument(
      <Harness enabled={false} onState={onState} />,
    );
    expect(database.loadQuery).not.toHaveBeenCalled();
    expect(database.listeners.size).toBe(0);

    await view.rerender(<Harness onState={onState} />);
    expect(database.listeners.size).toBe(1);
    await view.rerender(<Harness enabled={false} onState={onState} />);
    expect(database.listeners.size).toBe(0);
    const reads = database.loadQuery.mock.calls.length;
    database.counts.set("contact", 7);
    notifyMutation();
    expect(database.loadQuery).toHaveBeenCalledTimes(reads);

    await view.rerender(<Harness onState={onState} />);
    expect(state?.info.tableCounts.contact).toBe(7);
    await view.unmount();
    expect(database.errorListeners.size).toBe(0);
  });

  it("invalidates stale counts when a worker error leaves loadQuery unresolved", async () => {
    let state: DatabaseState | undefined;
    const onState = (value: DatabaseState) => {
      state = value;
    };
    database.counts.set("contact", 7);
    const view = await renderIntoDocument(<Harness onState={onState} />);
    expect(state?.info.tableCounts.contact).toBe(7);

    let release: (() => void) | undefined;
    database.loadQuery.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([{ count: 99 }]);
        }),
    );
    await act(async () => notifyMutation());
    expect(state?.isBusy).toBe(true);

    await act(async () => {
      database.getError.mockReturnValue({
        type: "SqliteError",
        error: { type: "TransferableError", error: "query failed" },
      });
      for (const listener of database.errorListeners) listener();
    });
    expect(state?.isBusy).toBe(false);
    expect(state?.info.tableCounts).toEqual({});
    expect(state?.info.historyCount).toBeNull();
    expect(database.listeners.size).toBe(0);

    await act(async () => release?.());
    expect(state?.info.tableCounts).toEqual({});
    const reads = database.loadQuery.mock.calls.length;
    await view.rerender(<Harness enabled={false} onState={onState} />);
    await view.rerender(<Harness onState={onState} />);
    expect(database.loadQuery).toHaveBeenCalledTimes(reads);
    expect(state?.isBusy).toBe(false);
    await view.unmount();
  });
});
