import { RegistryContext } from "@linky-fit/linkstr-react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestAppRegistry, openTestEvolu } from "./testUtils/appRegistry";
import { renderIntoDocument } from "./testUtils/renderIntoDocument";

const database = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  listeners: new Set<() => void>(),
  loadQuery:
    vi.fn<(table: string) => Promise<ReadonlyArray<{ count: number }>>>(),
}));

// Evolu's queries are JSON with their SQL; the fake answers by table.
const tableOf = (query: string) => /from \\"(\w+)\\"/.exec(query)?.[1] ?? query;

vi.mock("@linky-fit/linksync/evolu", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linky-fit/linksync/evolu")>()),
  openLinkyEvolu: () =>
    Promise.resolve({
      name: "linky-test",
      loadQuery: (query: string) => database.loadQuery(tableOf(query)),
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

const Probe = ({ onState, enabled = true }: HarnessProps) => {
  onState(useEvoluDatabaseInfoState({ enabled }));
  return null;
};

const registry = makeTestAppRegistry();
await openTestEvolu(registry);

const Harness = (props: HarnessProps) => (
  <RegistryContext.Provider value={registry}>
    <Probe {...props} />
  </RegistryContext.Provider>
);

const notifyMutation = () => {
  for (const listener of database.listeners) listener();
};

beforeEach(() => {
  database.counts.clear();
  database.listeners.clear();
  database.loadQuery
    .mockReset()
    .mockImplementation(async (table) => [
      { count: database.counts.get(table) ?? 0 },
    ]);
});

describe("Evolu database diagnostics", () => {
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
  });
});
