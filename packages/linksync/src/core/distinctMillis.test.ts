import { describe, expect, it } from "vitest";
import { distinctMillis } from "./distinctMillis";

describe("distinctMillis", () => {
  it("never repeats a millisecond within a burst", () => {
    const next = distinctMillis();
    expect([next(100), next(100), next(100), next(101)]).toEqual([
      100, 101, 102, 103,
    ]);
  });

  it("follows the real clock once it is ahead", () => {
    const next = distinctMillis();
    next(100);
    next(100);
    expect(next(500)).toBe(500);
  });

  it("stops running ahead at a second's lead", () => {
    const next = distinctMillis();
    for (let i = 0; i < 2_000; i += 1) next(0);
    expect(next(0)).toBe(1_000);
  });
});
