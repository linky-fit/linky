import { describe, expect, it, vi } from "vitest";
import { boundedMemo } from "./boundedMemo";

describe("boundedMemo", () => {
  it("computes each input once, null results included", () => {
    const compute = vi.fn((input: string) =>
      input === "bad" ? null : { input },
    );
    const memo = boundedMemo(compute, 10);

    const first = memo("a");
    expect(memo("a")).toBe(first);
    expect(memo("bad")).toBeNull();
    expect(memo("bad")).toBeNull();
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("forgets the oldest input past its capacity", () => {
    const compute = vi.fn((input: string) => ({ input }));
    const memo = boundedMemo(compute, 2);

    const a = memo("a");
    memo("b");
    memo("c");
    expect(memo("c")).toEqual({ input: "c" });
    expect(compute).toHaveBeenCalledTimes(3);
    expect(memo("a")).not.toBe(a);
    expect(compute).toHaveBeenCalledTimes(4);
  });
});
