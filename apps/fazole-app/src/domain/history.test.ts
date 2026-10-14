import { createIdFromString } from "@linky-fit/domain";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { describe, expect, it } from "vitest";
import { groupByDay, historyEntries, relativeDay } from "./history";
import { CzkAmount } from "./money";
import type { PaymentStatus } from "./payment";
import type { DirectTransfer, Payment } from "./records";
import { VariableSymbol } from "./variableSymbol";

const at = (day: number, hour: number) =>
  new Date(2026, 9, day, hour).getTime() / 1000;

const id = (name: string) => createIdFromString<"Transaction">(name);

const payment = (
  name: string,
  createdAtSec: number,
  amount: number,
  status: PaymentStatus,
): Payment => ({
  id: id(name),
  amountCzk: CzkAmount.make(amount),
  tipCzk: null,
  vs: VariableSymbol.make("1234567890"),
  status,
  method: status === "paid" ? "bank" : null,
  createdAtSec,
  paidAtSec: null,
  bitcoin: null,
  cashuReceive: null,
  payerPubkey: null,
});

const transfer = (
  name: string,
  receivedAtSec: number,
  sats: number,
  czkPerBtc: number | null,
): DirectTransfer => ({
  id: id(name),
  sats,
  czkPerBtc,
  receivedAtSec,
  operationId: `receive-${name}`,
  mintUrl: "http://localhost:3338",
  payerPubkey: makeIdentity().pubkey,
  note: null,
});

const summary = (days: ReturnType<typeof groupByDay>) =>
  days.map((day) => ({
    startSec: day.startSec,
    paidTotal: day.paidTotal,
    ids: day.entries.map((entry) => entry.id),
  }));

describe("groupByDay", () => {
  it("groups by local day, newest first, totalling only paid payments", () => {
    const days = groupByDay(
      historyEntries(
        [
          payment("late", at(6, 23), 100, "pending"),
          payment("noon", at(6, 12), 250_00, "paid"),
          payment("early", at(6, 0), 1_50, "paid"),
          payment("cancelled", at(5, 18), 999_00, "cancelled"),
          payment("old", at(1, 9), 42_00, "paid"),
        ],
        [],
      ),
    );
    expect(summary(days)).toEqual([
      {
        startSec: at(6, 0),
        paidTotal: 251_50,
        ids: [id("late"), id("noon"), id("early")],
      },
      { startSec: at(5, 0), paidTotal: 0, ids: [id("cancelled")] },
      { startSec: at(1, 0), paidTotal: 42_00, ids: [id("old")] },
    ]);
  });

  it("lists direct transfers among payments and adds their CZK value at their rate to the day", () => {
    const days = groupByDay(
      historyEntries(
        [payment("paid", at(6, 10), 250_00, "paid")],
        [
          // 10 000 sat at 2 500 000 CZK/BTC are 250 Kč.
          transfer("direct", at(6, 12), 10_000, 2_500_000),
          transfer("no-rate", at(6, 11), 5_000, null),
        ],
      ),
    );
    expect(summary(days)).toEqual([
      {
        startSec: at(6, 0),
        paidTotal: 500_00,
        ids: [id("direct"), id("no-rate"), id("paid")],
      },
    ]);
  });

  it("sorts entries that synced out of order", () => {
    const [day] = groupByDay(
      historyEntries(
        [payment("a", at(6, 9), 1, "paid"), payment("b", at(6, 10), 1, "paid")],
        [],
      ),
    );
    expect(day?.entries.map((entry) => entry.id)).toEqual([id("b"), id("a")]);
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
