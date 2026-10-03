import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Payment, SupporterStorage, TokenHash } from "./storage";
import { testPubkey, testRumorId, withTempDir } from "./testSupport";

const hash = TokenHash.make("a".repeat(64));

const payment = new Payment({
  tokenHash: hash,
  sender: testPubkey(1),
  rumorId: testRumorId("b"),
  amount: 5_000,
  tier: "bronze",
  state: "receiving",
  result: null,
  createdAt: 1,
  updatedAt: 1,
});

describe("SupporterStorage payments", () => {
  it("records a payment and keeps its result across a reopen", async () => {
    await withTempDir((directory) => {
      const path = join(directory, "supporter.sqlite");
      const first = new SupporterStorage(path);
      first.insertPayment(payment);
      first.updatePayment(
        hash,
        { state: "ready", result: { status: "thanks" } },
        2,
      );
      first.close();

      const reopened = new SupporterStorage(path);
      expect(reopened.findPayment(hash)).toEqual(
        new Payment({
          ...payment,
          state: "ready",
          result: { status: "thanks" },
          updatedAt: 2,
        }),
      );
      reopened.close();
    });
  });

  it("keeps the stored result when only the state moves on", () => {
    const storage = new SupporterStorage(":memory:");
    storage.insertPayment(payment);
    storage.updatePayment(
      hash,
      { state: "ready", result: { status: "refused", reason: "token_spent" } },
      2,
    );
    storage.updatePayment(hash, { state: "delivered" }, 3);
    expect(storage.findPayment(hash)?.result).toEqual({
      status: "refused",
      reason: "token_spent",
    });
  });

  it("lists every payment that is not delivered yet", () => {
    const storage = new SupporterStorage(":memory:");
    const other = TokenHash.make("c".repeat(64));
    storage.insertPayment(payment);
    storage.insertPayment(new Payment({ ...payment, tokenHash: other }));
    storage.updatePayment(other, { state: "delivered" }, 2);
    expect(
      storage.unfinishedPayments().map((stored) => stored.tokenHash),
    ).toEqual([hash]);
    expect(storage.findPayment(TokenHash.make("d".repeat(64)))).toBeNull();
  });
});

describe("SupporterStorage auto-replies and linkstr storage", () => {
  it("hands out one auto-reply per sender and day", () => {
    const storage = new SupporterStorage(":memory:");
    expect(storage.claimAutoReply(testPubkey(1), "2026-10-03")).toBe(true);
    expect(storage.claimAutoReply(testPubkey(1), "2026-10-03")).toBe(false);
    expect(storage.claimAutoReply(testPubkey(2), "2026-10-03")).toBe(true);
    expect(storage.claimAutoReply(testPubkey(1), "2026-10-04")).toBe(true);
  });

  it("stores linkstr's strings", () => {
    const storage = new SupporterStorage(":memory:");
    expect(storage.linkstrStorage.getItem("outbox")).toBeNull();
    storage.linkstrStorage.setItem("outbox", "[]");
    storage.linkstrStorage.setItem("outbox", "[1]");
    expect(storage.linkstrStorage.getItem("outbox")).toBe("[1]");
  });
});
