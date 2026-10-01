import {
  isRetryablePaymentAmountFailure,
  MintUrl,
  PaymentFailed,
  QuoteId,
} from "@linky-fit/linkshu";
import { describe, expect, it } from "vitest";
import { describeMeltFailure, getErrorMessage } from "./wallet";

const paymentFailed = (detail: string | null) =>
  new PaymentFailed({
    mint: MintUrl.make("https://mint.example"),
    quoteId: QuoteId.make("quote"),
    detail,
  });

describe("describeMeltFailure", () => {
  it("lets the lower-amount retry match the mint's melt input shortage", () => {
    const message = describeMeltFailure(
      paymentFailed("not enough inputs provided for melt"),
    );
    expect(message).toBe(
      "Lightning payment failed: not enough inputs provided for melt",
    );
    expect(isRetryablePaymentAmountFailure(message)).toBe(true);
  });

  it("does not retry other payment failures", () => {
    expect(
      isRetryablePaymentAmountFailure(describeMeltFailure(paymentFailed(null))),
    ).toBe(false);
  });
});

describe("getErrorMessage", () => {
  it("describes a tagged error without a message by its tag and fields", () => {
    expect(getErrorMessage(paymentFailed("route"), "fallback")).toBe(
      'PaymentFailed {"mint":"https://mint.example","quoteId":"quote","detail":"route"}',
    );
  });
});
