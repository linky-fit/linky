import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useExclusiveRun } from "./useExclusiveRun";

const renderExclusiveRun = () => {
  const results: ReturnType<typeof useExclusiveRun>[] = [];
  const Harness: React.FC = () => {
    results.push(useExclusiveRun());
    return null;
  };
  act(() => {
    createRoot(document.createElement("div")).render(<Harness />);
  });
  const [runExclusively] = results;
  if (!runExclusively) throw new Error("hook did not render");
  return runExclusively;
};

const deferred = () => {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

describe("useExclusiveRun", () => {
  it("drops calls made while a task is running", async () => {
    const runExclusively = renderExclusiveRun();
    const pending = deferred();
    const pay = vi.fn(() => pending.promise);

    const first = runExclusively(pay);
    await runExclusively(pay);
    expect(pay).toHaveBeenCalledOnce();

    pending.resolve();
    await first;
    await runExclusively(pay);
    expect(pay).toHaveBeenCalledTimes(2);
  });

  it("releases the guard when the task fails", async () => {
    const runExclusively = renderExclusiveRun();
    const pending = deferred();

    const failed = runExclusively(() => pending.promise);
    pending.reject(new Error("mint down"));
    await expect(failed).rejects.toThrow("mint down");

    const pay = vi.fn(() => Promise.resolve());
    await runExclusively(pay);
    expect(pay).toHaveBeenCalledOnce();
  });
});
