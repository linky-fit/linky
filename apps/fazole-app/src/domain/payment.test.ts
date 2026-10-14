import { describe, expect, it } from "vitest";
import { canChangePaymentStatus, type PaymentStatus } from "./payment";

describe("canChangePaymentStatus", () => {
  it.each<[PaymentStatus, PaymentStatus, boolean]>([
    ["pending", "paid", true],
    ["pending", "cancelled", true],
    ["cancelled", "paid", true],
    ["pending", "pending", false],
    ["paid", "cancelled", false],
    ["paid", "pending", false],
    ["cancelled", "pending", false],
  ])("%s -> %s is %s", (from, to, allowed) => {
    expect(canChangePaymentStatus(from, to)).toBe(allowed);
  });
});
