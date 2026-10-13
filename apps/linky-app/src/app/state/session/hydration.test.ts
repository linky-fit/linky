import type { LinkyStore, OwnerId } from "@linky-fit/linksync";
import type { OwnerSync } from "@linky-fit/linksync/evolu";
import { Effect } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vitest";
import { memoryKvPorts } from "../../../testUtils/appRegistry";
import { makeTestLinkyStore } from "../../../testUtils/linkyStore";
import { platformAtom } from "../platform";
import { hydrationAtom } from "./hydration";

const opened = vi.hoisted(
  (): { store: LinkyStore | null; ownerSync: OwnerSync | null } => ({
    store: null,
    ownerSync: null,
  }),
);
// The store opens only when a test resolves it.
const storeOpened = vi.hoisted(() => ({ resolve: () => {} }));
vi.mock("./store", async () => {
  const { Atom } = await import("effect/reactivity");
  const { Effect } = await import("effect");
  return {
    linkyStoreAtom: Atom.make(() =>
      Effect.callback<LinkyStore>((resume) => {
        storeOpened.resolve = () => resume(Effect.succeed(opened.store!));
      }),
    ),
  };
});
vi.mock("./evolu", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    evoluAtom: Atom.make(() => ({
      ownerSync: opened.ownerSync!,
      appOwner: opened.store!.appOwner,
    })),
  };
});

const fakeOwnerSync = () => {
  const synced = new Set<OwnerId>();
  const listeners = new Set<() => void>();
  const ownerSync: OwnerSync = {
    syncedOwners: () => synced,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    subscribeFailures: () => () => {},
  };
  const report = (ownerId: OwnerId) => {
    synced.add(ownerId);
    for (const listener of listeners) listener();
  };
  return { ownerSync, report };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const boot = (awaiting: boolean) => {
  const { appOwner, db, store } = makeTestLinkyStore(1, { holdSync: true });
  const { ports } = memoryKvPorts(
    awaiting
      ? { [`linky.shards.awaitingFirstHydration.${appOwner.id}`]: "1" }
      : {},
  );
  const { ownerSync, report } = fakeOwnerSync();
  opened.store = store;
  opened.ownerSync = ownerSync;
  const registry = AtomRegistry.make({
    initialValues: [[platformAtom, ports]],
  });
  registry.mount(hydrationAtom);
  const finish = (ownerId: OwnerId) => {
    report(ownerId);
    db.finishSync(ownerId);
  };
  return { registry, store, finish };
};

describe("hydrationAtom", () => {
  it("reads hydrated at once on a device that holds the account", () => {
    const { registry } = boot(false);
    expect(registry.get(hydrationAtom)).toEqual({ _tag: "Hydrated" });
  });

  it("counts a restored account's owners as their sync rounds finish, until it hydrates", async () => {
    const { registry, store, finish } = boot(true);
    expect(registry.get(hydrationAtom)).toEqual({
      _tag: "Hydrating",
      synced: 0,
      total: null,
    });
    storeOpened.resolve();
    await settle();
    const owners = Effect.runSync(store.syncOwners());
    expect(registry.get(hydrationAtom)).toEqual({
      _tag: "Hydrating",
      synced: 0,
      total: owners.length,
    });

    finish(owners[0]!.id);
    await settle();
    expect(registry.get(hydrationAtom)).toEqual({
      _tag: "Hydrating",
      synced: 1,
      total: owners.length,
    });

    for (const owner of owners.slice(1)) finish(owner.id);
    await settle();
    expect(registry.get(hydrationAtom)).toEqual({ _tag: "Hydrated" });
  });
});
