import * as Evolu from "@evolu/common";
import { describe, expect, it } from "vitest";
import { resolveContactRowOwnerLane } from "./contactOwnerLane";
import { readRowOwnerId } from "./rowOwnerId";

describe("contact owner lane", () => {
  const owner0 = Evolu.OwnerId.orThrow("AAAAAAAAAAAAAAAAAAAAAA");
  const owner1 = Evolu.OwnerId.orThrow("AQEBAQEBAQEBAQEBAQEBAQ");

  it("reads the physical owner lane from an aggregated contact row", () => {
    expect(readRowOwnerId({ ownerId: owner1 })).toBe(owner1);
    expect(readRowOwnerId({ ownerId: null })).toBe("");
  });

  it("resolves only visible owner lanes", () => {
    expect(
      resolveContactRowOwnerLane({ ownerId: owner1 }, [owner0, owner1]),
    ).toBe(owner1);
    expect(
      resolveContactRowOwnerLane({ ownerId: owner1 }, [owner0]),
    ).toBeNull();
  });
});
