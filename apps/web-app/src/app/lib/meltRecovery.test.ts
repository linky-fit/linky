import {
  Amount,
  MeltReceipt,
  MeltResumeResult,
  MintUrl,
  NonNegativeAmount,
  QuoteId,
  OperationId,
} from "@linky/linkshu";
import { describe, expect, it } from "vitest";
import {
  meltTransactionPatch,
  readMeltQuoteIdFromDetailsJson,
} from "./meltRecovery";

const result = (
  status: MeltResumeResult["status"],
  feePaid = 0,
): MeltResumeResult =>
  new MeltResumeResult({
    quoteId: QuoteId.make("quote-1"),
    mint: MintUrl.make("https://mint.example"),
    operationId: OperationId.make("op-1"),
    amount: Amount.make(40),
    status,
    receipt:
      status === "paid"
        ? new MeltReceipt({
            mint: MintUrl.make("https://mint.example"),
            quoteId: QuoteId.make("quote-1"),
            paidAmount: Amount.make(40),
            feeReserve: NonNegativeAmount.make(2),
            feePaid: NonNegativeAmount.make(feePaid),
            changeAmount: NonNegativeAmount.make(2 - feePaid),
          })
        : null,
  });

describe("meltTransactionPatch", () => {
  it("marks a paid melt ok with its amount and fee", () => {
    expect(meltTransactionPatch(result("paid", 1))).toEqual({
      status: "ok",
      amount: 40,
      fee: 1,
    });
  });

  it("omits a zero fee, which the transaction schema rejects", () => {
    expect(meltTransactionPatch(result("paid"))).toEqual({
      status: "ok",
      amount: 40,
    });
  });

  it("marks an unpaid melt failed with readable text", () => {
    expect(meltTransactionPatch(result("unpaid"))).toEqual({
      status: "error",
      error: "Lightning payment failed",
    });
  });

  it("leaves an unsettled melt alone", () => {
    expect(meltTransactionPatch(result("pending"))).toBeNull();
    expect(meltTransactionPatch(result("unresolved"))).toBeNull();
  });
});

describe("readMeltQuoteIdFromDetailsJson", () => {
  it("reads the quote id next to other details", () => {
    expect(
      readMeltQuoteIdFromDetailsJson(
        '{"lightningInvoice":"lnbc1","meltQuoteId":"quote-1"}',
      ),
    ).toBe("quote-1");
  });

  it("yields null for details without one or unparsable text", () => {
    expect(readMeltQuoteIdFromDetailsJson(null)).toBeNull();
    expect(readMeltQuoteIdFromDetailsJson('{"lightningInvoice":"x"}')).toBe(
      null,
    );
    expect(readMeltQuoteIdFromDetailsJson('{"meltQuoteId":""}')).toBeNull();
    expect(readMeltQuoteIdFromDetailsJson("{not json")).toBeNull();
  });
});
