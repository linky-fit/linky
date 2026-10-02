import {
  createBoltCard,
  issueBoltCardTap,
  type BoltCard,
  type BoltCardTap,
} from "@linky-fit/bolt-card";
import { describe, expect, it } from "vitest";
import {
  invoiceTimestamp,
  makeLightningInvoice,
} from "../../testUtils/lightningInvoice";
import {
  BoltCardRejection,
  BoltCardTapSession,
  estimateMaxWithdrawableSat,
} from "./boltCardTapSession";

const k1 = "ab".repeat(32);
const now = invoiceTimestamp + 10;

const tapOf = (card: BoltCard): BoltCardTap => {
  const tap = issueBoltCardTap(card, "https://bridge.example");
  if (!tap) throw new Error("card exhausted");
  return tap;
};

const cOf = (tap: BoltCardTap): string =>
  new URL(tap.url.replace(/^lnurlw:/, "https:")).searchParams.get("c") ?? "";

const withdraw = (tap: BoltCardTap, id = "1") => ({
  _tag: "withdraw" as const,
  id,
  p: tap.p,
  c: cOf(tap),
});

const callback = (pr: string, id = "2", requestK1 = k1) => ({
  _tag: "callback" as const,
  id,
  k1: requestK1,
  pr,
});

const sessionWithTap = () => {
  const card = createBoltCard();
  const tap = tapOf(card);
  const session = new BoltCardTapSession(card);
  session.issue(tap);
  return { card, session, tap };
};

describe("estimateMaxWithdrawableSat", () => {
  it("keeps 1 % and at least 2 sat for the melt fee reserve", () => {
    expect(estimateMaxWithdrawableSat(0)).toBe(0);
    expect(estimateMaxWithdrawableSat(2)).toBe(0);
    expect(estimateMaxWithdrawableSat(100)).toBe(98);
    expect(estimateMaxWithdrawableSat(10_000)).toBe(9_900);
    expect(estimateMaxWithdrawableSat(10_050.7)).toBe(9_949);
  });
});

describe("BoltCardTapSession", () => {
  it("offers an issued tap and takes one invoice within the limit", () => {
    const { session, tap } = sessionWithTap();
    const offer = session.answerWithdraw(withdraw(tap), 5_000, k1);
    expect(offer).toEqual({
      counter: 1,
      reply: {
        _tag: "offer",
        id: "1",
        k1,
        minWithdrawable: 1_000,
        maxWithdrawable: 5_000_000,
        defaultDescription: "Linky",
      },
    });

    const answer = session.answerCallback(
      callback(makeLightningInvoice("20u")),
      now,
    );
    expect(answer.reply).toEqual({ _tag: "accepted", id: "2" });
    expect(answer.invoice?.amountSat).toBe(2_000);
    expect(session.hasInvoice).toBe(true);

    expect(
      session.answerCallback(callback(makeLightningInvoice("20u"), "3"), now)
        .reply,
    ).toEqual({
      _tag: "rejected",
      id: "3",
      reason: BoltCardRejection.alreadyPaying,
    });
  });

  it("answers a repeated request for the same read with the same offer", () => {
    const { session, tap } = sessionWithTap();
    session.answerWithdraw(withdraw(tap), 5_000, k1);
    const again = session.answerWithdraw(
      withdraw(tap, "9"),
      1,
      "cd".repeat(32),
    );
    expect(again.reply).toMatchObject({ _tag: "offer", id: "9", k1 });
  });

  it("rejects taps it did not issue in this session", () => {
    const { card, session } = sessionWithTap();
    const other = tapOf({ ...card, counter: 5 });
    expect(session.answerWithdraw(withdraw(other), 5_000, k1).reply).toEqual({
      _tag: "rejected",
      id: "1",
      reason: BoltCardRejection.unknownTap,
    });
  });

  it("rejects card data that does not verify", () => {
    const { session, tap } = sessionWithTap();
    const forged = { ...withdraw(tap), c: "00".repeat(8) };
    expect(session.answerWithdraw(forged, 5_000, k1).reply).toMatchObject({
      reason: BoltCardRejection.invalidCard,
    });
  });

  it("rejects a tap when nothing can be paid", () => {
    const { session, tap } = sessionWithTap();
    expect(session.answerWithdraw(withdraw(tap), 0, k1).reply).toMatchObject({
      reason: BoltCardRejection.insufficientBalance,
    });
  });

  it("rejects invoices for another k1, over the limit, amountless or expired", () => {
    const { session, tap } = sessionWithTap();
    session.answerWithdraw(withdraw(tap), 1_000, k1);
    const reasonFor = (pr: string, requestK1 = k1, nowSec = now) => {
      const { reply } = session.answerCallback(
        callback(pr, "2", requestK1),
        nowSec,
      );
      return reply._tag === "rejected" ? reply.reason : null;
    };
    expect(reasonFor(makeLightningInvoice("20u"), "cd".repeat(32))).toBe(
      BoltCardRejection.unknownK1,
    );
    expect(reasonFor(makeLightningInvoice("20u"))).toBe(
      BoltCardRejection.overLimit,
    );
    expect(reasonFor(makeLightningInvoice(""))).toBe(
      BoltCardRejection.invalidInvoice,
    );
    expect(
      reasonFor(makeLightningInvoice("5u", 60), k1, invoiceTimestamp + 61),
    ).toBe(BoltCardRejection.expiredInvoice);
    expect(session.hasInvoice).toBe(false);
  });
});
