import { describe, expect, it } from "vitest";
import type { ShardSummary } from "../hooks/useLinksync";
import { filterRowsToVisibleShards, scopeOfTable } from "./shardTables";

const shards: ShardSummary[] = [
  {
    scope: "messages",
    index: 1,
    ownerId: "m1",
    visibleOwnerIds: ["m0", "m1"],
    rotates: true,
  },
];

describe("shardTables", () => {
  it("knows which scope a table belongs to", () => {
    expect(scopeOfTable("message")).toBe("messages");
    expect(scopeOfTable("cashuProof")).toBe("cashu");
    expect(scopeOfTable("shardPointer")).toBe("meta");
    expect(scopeOfTable("nostrMessage")).toBeNull();
  });

  it("keeps the rows of visible shards and every row of a legacy table", () => {
    const rows = [{ ownerId: "m0" }, { ownerId: "m1" }, { ownerId: "m2" }];
    expect(
      filterRowsToVisibleShards("message", rows, shards, (row) => row.ownerId),
    ).toEqual([{ ownerId: "m0" }, { ownerId: "m1" }]);
    expect(
      filterRowsToVisibleShards(
        "nostrMessage",
        rows,
        shards,
        (row) => row.ownerId,
      ),
    ).toEqual(rows);
  });
});
