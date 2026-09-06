import * as Evolu from "@evolu/common";
import { describe, expect, it } from "vitest";
import { createCashuTokenRowFixture } from "../../testUtils/cashuTokenRow";
import { isCashuRowCandidateBetter } from "./cashuRowPreference";

const owner0 = Evolu.OwnerId.orThrow("AAAAAAAAAAAAAAAAAAAAAA");
const owner1 = Evolu.OwnerId.orThrow("AQEBAQEBAQEBAQEBAQEBAQ");
const ownerRank = new Map([
  [owner0, 0],
  [owner1, 1],
]);

describe("isCashuRowCandidateBetter", () => {
  it("lets a newer-lane tombstone suppress an older live duplicate", () => {
    expect(
      isCashuRowCandidateBetter({
        activeOwnerId: owner1,
        candidate: createCashuTokenRowFixture({
          id: "newer-tombstone",
          isDeleted: true,
          ownerId: owner1,
        }),
        existing: createCashuTokenRowFixture({
          id: "older-live",
          ownerId: owner0,
        }),
        ownerRank,
      }),
    ).toBe(true);
  });

  it("keeps a newer live re-import over an older tombstone", () => {
    expect(
      isCashuRowCandidateBetter({
        activeOwnerId: owner1,
        candidate: createCashuTokenRowFixture({
          id: "newer-live",
          ownerId: owner1,
        }),
        existing: createCashuTokenRowFixture({
          id: "older-tombstone",
          isDeleted: true,
          ownerId: owner0,
        }),
        ownerRank,
      }),
    ).toBe(true);
  });

  it("prefers a valid duplicate to an error in the same lane", () => {
    expect(
      isCashuRowCandidateBetter({
        activeOwnerId: owner1,
        candidate: createCashuTokenRowFixture({
          id: "accepted",
          ownerId: owner1,
          state: "accepted",
        }),
        existing: createCashuTokenRowFixture({
          id: "error",
          ownerId: owner1,
          state: "error",
        }),
        ownerRank,
      }),
    ).toBe(true);
  });
});
