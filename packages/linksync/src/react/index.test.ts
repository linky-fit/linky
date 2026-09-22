// @vitest-environment jsdom
import { NonEmptyString100, PositiveInt } from "@evolu/common";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createId } from "@linky/domain";
import { makeTransactionsRepository } from "../repositories/transactions";
import { linkyStore, runNow } from "../testing/linky";
import { useRepositoryRows, useVisibleShards } from "./index";

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
});
