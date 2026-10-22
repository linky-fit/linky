import { describe, expect, it } from "vitest";
import {
  completionRate,
  inPeriod,
  monthlyAnalytics,
  transferAnalytics,
} from "./analytics";
import { operatorTransferOf as transferOf } from "./testing/transfers";

const all = () => true;
const sec = (iso: string) => Date.parse(iso) / 1000;

describe("transferAnalytics", () => {
  it("counts only completed transfers toward the amount, what users sent and the fees", () => {
    const stats = transferAnalytics(
      [
        transferOf({ status: "completed", amount: 100_000, fee: 1_000 }),
        transferOf({ status: "completed", amount: 50_000, fee: 500 }),
        transferOf({ status: "refunded", amount: 70_000, fee: 700 }),
        transferOf({ status: "cancelled", amount: 80_000, fee: 800 }),
        transferOf({ status: "denied", amount: 90_000, fee: 900 }),
        transferOf({ status: "fundsReceived", amount: 60_000, fee: 600 }),
        transferOf({ status: null, amount: 40_000 }),
      ],
      all,
    );
    expect(stats.completed).toEqual({
      count: 2,
      amount: 150_000,
      sent: 151_500,
      fees: 1_500,
    });
  });

  it("splits completed transfers by direction", () => {
    const stats = transferAnalytics(
      [
        transferOf({ status: "completed", direction: "receive", fee: 1_000 }),
        transferOf({ status: "completed", direction: "receive", fee: 2_000 }),
        transferOf({
          status: "completed",
          direction: "send",
          amount: 250_000,
          fee: 2_500,
        }),
        transferOf({ status: "refunded", direction: "send" }),
      ],
      all,
    );
    expect(stats.byDirection).toEqual({
      receive: { count: 2, amount: 200_000, sent: 203_000, fees: 3_000 },
      send: { count: 1, amount: 250_000, sent: 252_500, fees: 2_500 },
    });
  });

  it("counts every transfer by outcome, unanswered and in-progress ones as open", () => {
    const stats = transferAnalytics(
      [
        transferOf({ status: "completed" }),
        transferOf({ status: null }),
        transferOf({ status: "accepted" }),
        transferOf({ status: "fundsSeen" }),
        transferOf({ status: "fundsReceived" }),
        transferOf({ status: "refunded" }),
        transferOf({ status: "cancelled" }),
        transferOf({ status: "cancelled" }),
        transferOf({ status: "denied" }),
      ],
      all,
    );
    expect(stats.outcomes).toEqual({
      completed: 1,
      open: 4,
      refunded: 1,
      cancelled: 2,
      denied: 1,
    });
  });

  it("is all zeros without transfers", () => {
    const empty = { count: 0, amount: 0, sent: 0, fees: 0 };
    expect(transferAnalytics([], all)).toEqual({
      completed: empty,
      byDirection: { receive: empty, send: empty },
      outcomes: { completed: 0, open: 0, refunded: 0, cancelled: 0, denied: 0 },
    });
  });

  it("leaves out transfers requested outside the period, from totals and outcomes", () => {
    const now = sec("2026-10-20T12:00:00Z");
    const stats = transferAnalytics(
      [
        transferOf({ status: "completed", createdAtSec: now - 3_600 }),
        transferOf({ status: "completed", createdAtSec: now - 40 * 86_400 }),
        transferOf({ status: "denied", createdAtSec: now - 40 * 86_400 }),
      ],
      inPeriod("last30Days", now, "UTC"),
    );
    expect(stats.completed.count).toBe(1);
    expect(stats.outcomes.denied).toBe(0);
  });
});

describe("inPeriod", () => {
  const now = sec("2026-10-20T12:00:00Z");

  it("takes every time for all time", () => {
    expect(inPeriod("allTime", now, "UTC")(0)).toBe(true);
  });

  it("takes the last 30 days up to now, the boundary itself excluded", () => {
    const includes = inPeriod("last30Days", now, "UTC");
    expect(includes(now)).toBe(true);
    expect(includes(now - 30 * 86_400 + 1)).toBe(true);
    expect(includes(now - 30 * 86_400)).toBe(false);
  });

  it("takes this calendar month in the given time zone", () => {
    const utc = inPeriod("thisMonth", now, "UTC");
    expect(utc(sec("2026-10-01T00:00:00Z"))).toBe(true);
    expect(utc(sec("2026-09-30T23:59:59Z"))).toBe(false);
    expect(utc(sec("2026-10-31T23:59:59Z"))).toBe(true);
    // 2026-09-30T22:30Z is already 1 October 00:30 in Prague (UTC+2).
    const prague = inPeriod("thisMonth", now, "Europe/Prague");
    expect(prague(sec("2026-09-30T22:30:00Z"))).toBe(true);
    expect(prague(sec("2026-09-30T21:30:00Z"))).toBe(false);
  });
});

describe("completionRate", () => {
  it("is the completed share of finished transfers, ignoring open ones", () => {
    expect(
      completionRate({
        completed: 3,
        open: 5,
        refunded: 1,
        cancelled: 0,
        denied: 0,
      }),
    ).toBe(0.75);
  });

  it("is null while no transfer finished", () => {
    expect(
      completionRate({
        completed: 0,
        open: 2,
        refunded: 0,
        cancelled: 0,
        denied: 0,
      }),
    ).toBeNull();
  });
});

describe("monthlyAnalytics", () => {
  it("buckets completed transfers by request month, newest first, per direction", () => {
    const months = monthlyAnalytics(
      [
        transferOf({
          status: "completed",
          direction: "receive",
          createdAtSec: sec("2026-09-03T10:00:00Z"),
        }),
        transferOf({
          status: "completed",
          direction: "send",
          createdAtSec: sec("2026-10-05T10:00:00Z"),
        }),
        transferOf({
          status: "completed",
          direction: "send",
          fee: 2_000,
          createdAtSec: sec("2026-10-06T10:00:00Z"),
        }),
        transferOf({
          status: "refunded",
          direction: "send",
          createdAtSec: sec("2026-08-06T10:00:00Z"),
        }),
      ],
      "UTC",
    );
    expect(months).toEqual([
      {
        month: "2026-10",
        byDirection: {
          receive: { count: 0, amount: 0, sent: 0, fees: 0 },
          send: { count: 2, amount: 200_000, sent: 203_000, fees: 3_000 },
        },
      },
      {
        month: "2026-09",
        byDirection: {
          receive: {
            count: 1,
            amount: 100_000,
            sent: 101_000,
            fees: 1_000,
          },
          send: { count: 0, amount: 0, sent: 0, fees: 0 },
        },
      },
    ]);
  });

  it("follows the given time zone at a month boundary", () => {
    const transfers = [
      transferOf({
        status: "completed",
        createdAtSec: sec("2026-09-30T22:30:00Z"),
      }),
    ];
    expect(
      monthlyAnalytics(transfers, "UTC").map(({ month }) => month),
    ).toEqual(["2026-09"]);
    expect(
      monthlyAnalytics(transfers, "Europe/Prague").map(({ month }) => month),
    ).toEqual(["2026-10"]);
  });

  it("is empty without completed transfers", () => {
    expect(monthlyAnalytics([transferOf({ status: "denied" })], "UTC")).toEqual(
      [],
    );
  });
});
