import { createId } from "@linky/linksync";
import { describe, expect, it } from "vitest";
import { makeTestLinkyStore } from "../../testUtils/linkyStore";
import { legacyProofsToMarkSpent } from "./legacySpentProofs";

const legacyOwner = makeTestLinkyStore(1).appOwner.id;
const otherOwner = makeTestLinkyStore(2).appOwner.id;
const owners = new Set([legacyOwner]);

describe("legacy spent proof compatibility", () => {
  it("marks every legacy copy spent when any shard copy is spent, without touching foreign owners", () => {
    const id = createId<"CashuProof">();
    const available = { id, ownerId: legacyOwner, state: "available" };
    const held = { ...available, state: "held" };
    const spent = { ...available, state: "spent" };
    const foreign = { ...available, ownerId: otherOwner };
    expect(
      legacyProofsToMarkSpent(
        [available, held, spent, foreign],
        [
          { id, state: "available" },
          { id, state: "spent" },
        ],
        owners,
      ),
    ).toEqual([available, held]);
  });

  it("does not copy new proofs, nonterminal states, or undo a spent mark", () => {
    const id = createId<"CashuProof">();
    const legacy = { id, ownerId: legacyOwner, state: "spent" };
    expect(
      legacyProofsToMarkSpent(
        [legacy],
        [
          { id, state: "available" },
          { id: createId<"CashuProof">(), state: "spent" },
        ],
        owners,
      ),
    ).toEqual([]);
    expect(
      legacyProofsToMarkSpent(
        [{ ...legacy, state: "available" }],
        [{ id, state: "held" }],
        owners,
      ),
    ).toEqual([]);
    expect(
      legacyProofsToMarkSpent(
        [{ ...legacy, state: "available" }],
        [{ id, state: "spent" }],
        new Set(),
      ),
    ).toEqual([]);
  });
});
