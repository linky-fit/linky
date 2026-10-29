import {
  amountFromSent,
  amountWithServiceFee,
  depositTerms,
  serviceFee,
} from "./fees";

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

describe("amountFromSent", () => {
  it("is the largest amount whose amount with the fee fits what was sent", () => {
    expect(amountFromSent(101_000, 100)).toBe(100_000);
    expect(amountFromSent(150_000, 100)).toBe(148_514);
    expect(amountWithServiceFee(148_514, 100)).toBe(150_000);
    expect(amountWithServiceFee(148_515, 100)).toBeGreaterThan(150_000);
    // 102 sat is no amount with its fee: 100 → 101, 101 → 103.
    expect(amountFromSent(102, 100)).toBe(100);
    expect(amountFromSent(500_000, 0)).toBe(500_000);
    expect(amountFromSent(0, 100)).toBe(0);
  });
});

describe("depositTerms", () => {
  const limits = {
    feeBasisPoints: 100,
    minReceiveAmount: 100_000,
    maxReceiveAmount: 300_000,
  };

  it("is nothing while the deposit is short of the minimum with its fee", () => {
    expect(depositTerms({ ...limits, received: 100_999 })).toBeNull();
    expect(depositTerms({ ...limits, received: 101_000 })).toEqual({
      amount: 100_000,
      fee: 1_000,
      sendAmount: 101_000,
    });
  });

  it("gives the deposit minus the fee, rounding sats going to the fee", () => {
    expect(depositTerms({ ...limits, received: 150_000 })).toEqual({
      amount: 148_514,
      fee: 1_486,
      sendAmount: 150_000,
    });
    expect(depositTerms({ ...limits, received: 150_001 })).toEqual({
      amount: 148_515,
      fee: 1_486,
      sendAmount: 150_001,
    });
  });

  it("caps the amount at the maximum and leaves the rest of the deposit to settle", () => {
    expect(depositTerms({ ...limits, received: 303_000 })).toEqual({
      amount: 300_000,
      fee: 3_000,
      sendAmount: 303_000,
    });
    expect(depositTerms({ ...limits, received: 400_000 })).toEqual({
      amount: 300_000,
      fee: 3_000,
      sendAmount: 303_000,
    });
  });
});
