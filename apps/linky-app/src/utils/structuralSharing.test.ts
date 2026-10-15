import { describe, expect, it } from "vitest";
import { keepUnchangedLists, keepUnchangedRows } from "./structuralSharing";

describe("keepUnchangedRows", () => {
  it("keeps the previous row for every row whose fields did not change", () => {
    const a = { id: "a", text: "one" };
    const b = { id: "b", text: "two" };
    const next = keepUnchangedRows(
      [a, b],
      [
        { id: "a", text: "one" },
        { id: "b", text: "changed" },
        { id: "c", text: "new" },
      ],
    );

    expect(next[0]).toBe(a);
    expect(next[1]).toEqual({ id: "b", text: "changed" });
    expect(next[1]).not.toBe(b);
    expect(next).toHaveLength(3);
  });

  it("returns the previous array when no row changed", () => {
    const previous = [
      { id: "a", text: "one" },
      { id: "b", text: "two" },
    ];

    expect(
      keepUnchangedRows(previous, [
        { id: "a", text: "one" },
        { id: "b", text: "two" },
      ]),
    ).toBe(previous);
  });

  it("treats a row with a field added or removed as changed", () => {
    const previous: Array<{ id: string; note?: string }> = [{ id: "a" }];

    const next = keepUnchangedRows(previous, [{ id: "a", note: "x" }]);

    expect(next).not.toBe(previous);
    expect(next[0]).toEqual({ id: "a", note: "x" });
  });

  it("returns a reordered array with the previous rows", () => {
    const a = { id: "a" };
    const b = { id: "b" };

    const next = keepUnchangedRows([a, b], [{ id: "b" }, { id: "a" }]);

    expect(next[0]).toBe(b);
    expect(next[1]).toBe(a);
  });
});

describe("keepUnchangedLists", () => {
  it("keeps the previous list of every key whose items are the same", () => {
    const one = { id: "1" };
    const two = { id: "2" };
    const unchanged = [one];
    const previous = new Map([
      ["a", unchanged],
      ["b", [two]],
    ]);

    const next = keepUnchangedLists(
      previous,
      new Map([
        ["a", [one]],
        ["b", [two, { id: "3" }]],
      ]),
    );

    expect(next).not.toBe(previous);
    expect(next.get("a")).toBe(unchanged);
    expect(next.get("b")).toHaveLength(2);
  });

  it("returns the previous map when no list changed", () => {
    const one = { id: "1" };
    const previous = new Map([["a", [one]]]);

    expect(keepUnchangedLists(previous, new Map([["a", [one]]]))).toBe(
      previous,
    );
    expect(keepUnchangedLists(previous, new Map())).not.toBe(previous);
  });
});
