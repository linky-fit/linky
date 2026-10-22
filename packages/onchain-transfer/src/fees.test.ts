import { serviceFee, amountWithServiceFee } from "./fees";

describe("service fee", () => {
  it("takes the basis points of the amount on top of it", () => {
    expect(serviceFee(100_000, 100)).toBe(1_000);
    expect(amountWithServiceFee(100_000, 100)).toBe(101_000);
  });

  it("rounds a fractional fee up", () => {
    expect(serviceFee(123, 1)).toBe(1);
    expect(serviceFee(250_001, 150)).toBe(3_751);
    expect(amountWithServiceFee(250_001, 150)).toBe(253_752);
  });

  it("is zero at zero basis points and the amount again at 10000", () => {
    expect(serviceFee(500_000, 0)).toBe(0);
    expect(amountWithServiceFee(500_000, 0)).toBe(500_000);
    expect(amountWithServiceFee(500_000, 10_000)).toBe(1_000_000);
  });
});
