// @vitest-environment jsdom
import { NonEmptyString100, PositiveInt } from "@evolu/common";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createId } from "../model/ids";
import { makeTransactionsRepository } from "../repositories/transactions";
import { linkyStore, runNow } from "../testing/linky";
import { makeInMemoryShardDb } from "../core";
import { linkyTableColumns, type LinkyDbSchema } from "../model/schema";
import { createLinkyStore } from "../model/store";
import { testAppOwner } from "../testing/toy";
import { useHydrated, useRepositoryRows, useVisibleShards } from "./index";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const text = (value: string) => NonEmptyString100.orThrow(value);

const mount = async (component: () => null) => {
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(component)));
  return {
    unmount: async () => {
      await act(async () => root.unmount());
    },
  };
};

const settle = () => act(async () => {});

describe("react bindings", () => {
  it("re-reads the repository after every write", async () => {
    const { store } = linkyStore();
    const transactions = makeTransactionsRepository(store);
    const seen: number[] = [];
    const view = await mount(() => {
      seen.push(useRepositoryRows(transactions).length);
      return null;
    });
    await settle();
    runNow(
      transactions.insert({
        id: createId<"Transaction">(),
        createdAtSec: PositiveInt.orThrow(1),
        direction: text("in"),
        status: text("ok"),
      }),
    );
    await settle();
    expect(seen.at(-1)).toBe(1);
    await view.unmount();
  });

  it("follows the visible shards across a rotation", async () => {
    const { store } = linkyStore();
    let indexes: ReadonlyArray<number> = [];
    const view = await mount(() => {
      indexes = useVisibleShards(store, "transactions").map(
        (shard) => shard.index,
      );
      return null;
    });
    await settle();
    expect(indexes).toEqual([0]);
    runNow(store.rotate("transactions"));
    await settle();
    expect(indexes).toEqual([0, 1]);
    await view.unmount();
  });

  it("turns hydrated once every synced owner finished", async () => {
    const db = makeInMemoryShardDb<LinkyDbSchema>(linkyTableColumns, {
      holdSync: true,
    });
    const store = createLinkyStore(db, testAppOwner());
    let hydrated: boolean | null = null;
    const view = await mount(() => {
      hydrated = useHydrated(store);
      return null;
    });
    await settle();
    expect(hydrated).toBe(false);
    for (const owner of runNow(store.syncOwners())) db.finishSync(owner.id);
    await settle();
    expect(hydrated).toBe(true);
    await view.unmount();
  });
});
