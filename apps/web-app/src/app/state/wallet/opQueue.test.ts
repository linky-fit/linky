import { Effect, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  makeTestAppRegistry,
  testPlatformPorts,
} from "../../../testUtils/appRegistry";
import { makeWalletOps, walletOpRunningAtom, walletOpsAtom } from "./opQueue";

const gate = <A>(value: A) => {
  let open = () => {};
  const opened = new Promise<A>((resolve) => {
    open = () => resolve(value);
  });
  return { open, task: () => opened };
};

describe("wallet operation queue", () => {
  it("drops an exclusive operation started while another runs", async () => {
    const ops = makeWalletOps(() => {});
    const first = gate("first");

    const running = ops.runExclusiveTask(first.task);
    const dropped = await ops.runExclusiveTask(async () => "second");
    first.open();

    expect(dropped).toEqual(Option.none());
    expect(await running).toEqual(Option.some("first"));
    expect(await ops.runExclusiveTask(async () => "third")).toEqual(
      Option.some("third"),
    );
  });

  it("queues receives behind each other and drops payments meanwhile", async () => {
    const ops = makeWalletOps(() => {});
    const order: string[] = [];
    const receive = gate("receive");

    const first = ops.runQueuedTask(async () => {
      order.push("first started");
      return receive.task();
    });
    const second = ops.runQueuedTask(async () => {
      order.push("second started");
      return "second";
    });
    await Promise.resolve();
    const payment = await ops.runExclusiveTask(async () => "paid");
    receive.open();

    expect(await Promise.all([first, second])).toEqual(["receive", "second"]);
    expect(order).toEqual(["first started", "second started"]);
    expect(payment).toEqual(Option.none());
  });

  it("lets a background pass wait its turn without blocking or showing busy", async () => {
    const changes: boolean[] = [];
    const ops = makeWalletOps((running) => changes.push(running));
    const pass = gate("retried");

    const retrying = ops.runQueuedTask(pass.task, { background: true });
    const payment = await ops.runExclusiveTask(async () => "paid");
    pass.open();

    expect(payment).toEqual(Option.some("paid"));
    expect(await retrying).toBe("retried");
    expect(changes).toEqual([true, false]);
  });

  it("rejects with the task's error and frees the queue", async () => {
    const ops = makeWalletOps(() => {});
    const failure = new Error("mint down");

    await expect(
      ops.runExclusiveTask(() => Promise.reject(failure)),
    ).rejects.toBe(failure);
    await expect(ops.runQueuedTask(() => Promise.reject(failure))).rejects.toBe(
      failure,
    );
    expect(await ops.runExclusiveTask(async () => "next")).toEqual(
      Option.some("next"),
    );
  });

  it("holds back an app update for queued operations only, until they settle", async () => {
    const held: Promise<void>[] = [];
    const ops = makeWalletOps(
      () => {},
      (work) => held.push(work),
    );
    await ops.runExclusiveTask(async () => "paid");
    expect(held).toHaveLength(0);

    const receive = gate("receive");
    let released = false;
    const first = ops.runQueuedTask(receive.task);
    const waiting = ops.runQueuedTask(async () => "retried", {
      background: true,
    });
    void Promise.all(held).then(() => {
      released = true;
    });
    await new Promise((resolve) => setTimeout(resolve));

    expect(held).toHaveLength(2);
    expect(released).toBe(false);
    receive.open();
    await Promise.all([first, waiting, ...held]);
    expect(released).toBe(true);
  });

  it("holds back an app update through the platform's lifecycle", async () => {
    const deferUpdateWhile = vi.fn();
    const ports = testPlatformPorts();
    const registry = makeTestAppRegistry({
      ports: { ...ports, lifecycle: { ...ports.lifecycle, deferUpdateWhile } },
    });

    await registry.get(walletOpsAtom).runQueuedTask(async () => "received");

    expect(deferUpdateWhile).toHaveBeenCalledOnce();
  });

  it("reports a running operation through walletOpRunningAtom", async () => {
    const registry = makeTestAppRegistry();
    const ops = registry.get(walletOpsAtom);
    const operation = gate("done");

    const running = Effect.runPromise(
      ops.runExclusive(Effect.promise(operation.task)),
    );
    expect(registry.get(walletOpRunningAtom)).toBe(true);
    operation.open();
    await running;

    expect(registry.get(walletOpRunningAtom)).toBe(false);
  });
});
