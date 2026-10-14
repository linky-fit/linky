import { describe, expect, it } from "vitest";
import { groupByDay, relativeDay } from "./history";
import { CzkAmount } from "./money";
import type { PaymentStatus } from "./payment";

const at = (day: number, hour: number) =>
  new Date(2026, 9, day, hour).getTime() / 1000;

const payment = (
  id: string,
  createdAtSec: number,
  amount: number,
  status: PaymentStatus,
) => ({ id, createdAtSec, amountCzk: CzkAmount.make(amount), status });

describe("groupByDay", () => {
  it("groups by local day, newest first, totalling only paid payments", () => {
    const days = groupByDay([
      payment("late", at(6, 23), 100, "pending"),
      payment("noon", at(6, 12), 250_00, "paid"),
      payment("early", at(6, 0), 1_50, "paid"),
      payment("cancelled", at(5, 18), 999_00, "cancelled"),
      payment("old", at(1, 9), 42_00, "paid"),
    ]);
    expect(
      days.map((day) => ({
        startSec: day.startSec,
        paidTotal: day.paidTotal,
        ids: day.payments.map((p) => p.id),
      })),
    ).toEqual([
      { startSec: at(6, 0), paidTotal: 251_50, ids: ["late", "noon", "early"] },
      { startSec: at(5, 0), paidTotal: 0, ids: ["cancelled"] },
      { startSec: at(1, 0), paidTotal: 42_00, ids: ["old"] },
    ]);
  });

  it("sorts payments that synced out of order", () => {
    const [day] = groupByDay([
      payment("a", at(6, 9), 1, "paid"),
      payment("b", at(6, 10), 1, "paid"),
    ]);
    expect(day?.payments.map((p) => p.id)).toEqual(["b", "a"]);
  });
});

describe("relativeDay", () => {
  it("names today and yesterday, across a month boundary too", () => {
    expect(relativeDay(at(6, 0), at(6, 15))).toBe("today");
    expect(relativeDay(at(5, 0), at(6, 15))).toBe("yesterday");
    expect(relativeDay(at(4, 0), at(6, 15))).toBeNull();
    expect(relativeDay(new Date(2026, 8, 30).getTime() / 1000, at(1, 8))).toBe(
      "yesterday",
    );
  });
});
