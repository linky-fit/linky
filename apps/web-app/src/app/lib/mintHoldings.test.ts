import type { StoredProof } from "@linky-fit/linkshu";
import { describe, expect, it } from "vitest";
import {
  createStoredProofFixture,
  createTransferFixture,
} from "../../testUtils/cashuInventory";
import { holdingOf, mintHoldings } from "./mintHoldings";

const proof = (mint: string, amount: number, state: StoredProof["state"]) =>
  createStoredProofFixture({ mint, amount, state });

describe("mintHoldings", () => {
  it("sums only available proofs per mint", () => {
    const holdings = mintHoldings([
      proof("https://cashu.cz", 8, "available"),
      proof("https://cashu.cz", 4, "available"),
      proof("https://cashu.cz", 2, "held"),
      proof("https://cashu.cz", 1, "handedOut"),
      proof("https://cashu.cz", 1, "externalized"),
      proof("https://cashu.cz", 16, "spent"),
      proof("https://kashu.me", 32, "available"),
    ]);

    expect(holdingOf(holdings, "https://cashu.cz/")).toEqual({
      balance: 12,
      pending: 0,
    });
    expect(holdingOf(holdings, "https://kashu.me").balance).toBe(32);
    expect(holdingOf(holdings, "https://unknown.example").balance).toBe(0);
  });

  it("adds deferred receives as pending, apart from the balance", () => {
    const holdings = mintHoldings(
      [proof("https://cashu.cz", 8, "available")],
      [
        createTransferFixture({
          kind: "deferredReceive",
          status: "pending",
          mint: "https://cashu.cz",
          amount: 21,
        }),
        createTransferFixture({
          kind: "deferredReceive",
          status: "pending",
          mint: "https://offline.example",
          amount: 5,
        }),
      ],
    );

    expect(holdingOf(holdings, "https://cashu.cz")).toEqual({
      balance: 8,
      pending: 21,
    });
    expect(holdingOf(holdings, "https://offline.example")).toEqual({
      balance: 0,
      pending: 5,
    });
  });
});
