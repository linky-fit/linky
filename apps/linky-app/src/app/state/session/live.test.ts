import { Effect, Option } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vitest";
import { liveAtom, type LiveSource } from "./live";

const makeCountingSource = () => {
  const listeners = new Set<() => void>();
  let reads = 0;
  let subscriptions = 0;
  const source: LiveSource<number> = {
    all: Effect.sync(() => ++reads),
    subscribe: (listener) => {
      subscriptions += 1;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    source,
    notify: () => {
      for (const listener of [...listeners]) listener();
    },
    subscriptions: () => subscriptions,
  };
};

describe("liveAtom", () => {
  it("re-reads once per reported change through a single subscription", async () => {
    const counting = makeCountingSource();
    const live = liveAtom(
      Atom.make(Effect.succeed(counting.source)),
      (source) => source,
    );
    const registry = AtomRegistry.make();
    const unmount = registry.mount(live);
    const latest = () =>
      Option.getOrNull(AsyncResult.value(registry.get(live)));
    await vi.waitFor(() => expect(latest()).toBe(1));

    counting.notify();
    await vi.waitFor(() => expect(latest()).toBe(2));
    counting.notify();
    await vi.waitFor(() => expect(latest()).toBe(3));

    // Evolu reports the first query change after a subscribe, whichever query changed.
    expect(counting.subscriptions()).toBe(1);
    unmount();
  });
});
