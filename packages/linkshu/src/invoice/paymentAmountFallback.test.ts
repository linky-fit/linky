import { describe, expect, it } from "vitest";
import {
  buildPaymentFailureAmountAttempts,
  buildPaymentAmountAttempts,
  getPaymentAmountShortage,
  isRetryablePaymentAmountFailure,
} from "./paymentAmountFallback";

describe("buildPaymentAmountAttempts", () => {
  it("adds fee-reserve fallbacks when sending the full balance", () => {
    expect(buildPaymentAmountAttempts(10, 10)).toEqual([10, 9, 8, 7, 5, 2]);
  });

  it("deduplicates and drops non-positive fallback attempts", () => {
    expect(buildPaymentAmountAttempts(3, 3)).toEqual([3, 2, 1]);
    expect(buildPaymentAmountAttempts(1, 1)).toEqual([1]);
  });

  it("keeps a single attempt when not sending the full balance", () => {
    expect(buildPaymentAmountAttempts(10, 12)).toEqual([10]);
  });
});

describe("getPaymentAmountShortage", () => {
  it("parses melt provided/needed shortages", () => {
    expect(
      getPaymentAmountShortage(
        "MintOperationError: not enough inputs provided for melt. Provided: 150, needed: 151",
      ),
    ).toBe(1);
  });

  it("parses insufficient funds shortages", () => {
    expect(
      getPaymentAmountShortage("Insufficient funds (need 101, have 100)"),
    ).toBe(1);
  });
});

describe("buildPaymentFailureAmountAttempts", () => {
  it("prioritizes the exact melt shortage before generic fallbacks", () => {
    expect(
      buildPaymentFailureAmountAttempts(
        150,
        "MintOperationError: not enough inputs provided for melt. Provided: 150, needed: 151",
      ),
    ).toEqual([149, 148, 147, 145, 142, 137, 129]);
  });

  it("keeps a valid one-sat retry for tiny melt input-fee shortages", () => {
    expect(
      buildPaymentFailureAmountAttempts(
        2,
        "MintOperationError: not enough inputs provided for melt. Provided: 2, needed: 3",
      ),
    ).toEqual([1]);
  });
});

describe("isRetryablePaymentAmountFailure", () => {
  it("retries amount-related reserve failures", () => {
    expect(
      isRetryablePaymentAmountFailure(
        "Insufficient funds (need 101, have 100)",
      ),
    ).toBe(true);
    expect(isRetryablePaymentAmountFailure("Not enough balance to send")).toBe(
      true,
    );
    expect(isRetryablePaymentAmountFailure("Amount out of LNURL range")).toBe(
      true,
    );
  });

  it("does not retry unrelated failures", () => {
    expect(isRetryablePaymentAmountFailure("Invoice missing")).toBe(false);
  });
});
