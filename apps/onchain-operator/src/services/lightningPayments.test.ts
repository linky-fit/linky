import {
  Bolt11Invoice,
  MeltCost,
  MeltReceipt,
  MintRejected,
  MintUnreachable,
  MintUrl,
  OperationId,
  PaymentFailed,
  PaymentPending,
  QuoteExpired,
  QuoteId,
  Amount,
  type MeltError,
} from "@linky-fit/linkshu";
import { Result, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { LightningTarget, MintFunds } from "../domain/wallet";
import { nowSeconds } from "../utils/time";
import { createLightningPayments } from "./lightningPayments";
import { fakeWallet, testMint } from "./testing/fakes";
import type { Wallet } from "./wallet";

const mint = MintUrl.make(testMint);
const quoteId = QuoteId.make("quote-1");
const invoice = Bolt11Invoice.make("lnbcrt1000n1fake");
const fresh: LightningTarget = {
  kind: "invoice",
  invoice,
  amountSats: 100,
  expiresAtSec: nowSeconds() + 600,
};
const address: LightningTarget = {
  kind: "address",
  target: "alice@example.com",
};
const funds = (sats: number): MintFunds => ({ mint, sats });

const costOf = (amount: number, maxTotal: number) =>
  Schema.decodeUnknownSync(MeltCost)({
    quote: { quoteId, mint, amount, feeReserve: 2, expiresAt: null },
    inputFee: maxTotal - amount - 2,
    maxTotal,
  });

const receipt = Schema.decodeUnknownSync(MeltReceipt)({
  mint,
  quoteId,
  paidAmount: 100,
  feeReserve: 2,
  feePaid: 1,
  changeAmount: 1,
  serviceFee: 1,
});

/** A wallet whose melts answer as given; it records what it priced and paid. */
const walletWith = (melts: {
  readonly price?: (
    invoice: Bolt11Invoice,
  ) => Result.Result<MeltCost, MeltError>;
  readonly melt?: () => Result.Result<MeltReceipt, MeltError>;
  readonly resume?: Wallet["resumeMelts"];
}) => {
  const priced: Bolt11Invoice[] = [];
  const paid: { cost: MeltCost; invoice: Bolt11Invoice }[] = [];
  const wallet: Wallet = {
    ...fakeWallet().wallet,
    priceMelt: async (_mint, invoice) => {
      priced.push(invoice);
      return melts.price?.(invoice) ?? Result.succeed(costOf(100, 103));
    },
    melt: async (cost, invoice) => {
      paid.push({ cost, invoice });
      return melts.melt?.() ?? Result.succeed(receipt);
    },
    resumeMelts: melts.resume ?? (async () => []),
  };
  return { wallet, priced, paid };
};

describe("quoting a Lightning payment", () => {
  it("prices an invoice at the mint and shows the most it can take", async () => {
    const { wallet, priced } = walletWith({});
    const quoted = await createLightningPayments({ wallet }).quote(
      fresh,
      funds(500),
      100,
    );
    expect(priced).toEqual([invoice]);
    expect(Result.getOrThrow(quoted).cost.maxTotal).toBe(103);
  });

  it("refuses an expired invoice before asking the mint", async () => {
    const { wallet, priced } = walletWith({});
    const quoted = await createLightningPayments({ wallet }).quote(
      { ...fresh, expiresAtSec: nowSeconds() - 1 },
      funds(500),
      100,
    );
    expect(quoted).toEqual(Result.fail({ reason: "invoiceExpired" }));
    expect(priced).toEqual([]);
  });

  it("refuses when the mint's balance does not cover the fees too", async () => {
    const { wallet } = walletWith({});
    const quoted = await createLightningPayments({ wallet }).quote(
      fresh,
      funds(102),
      100,
    );
    expect(quoted).toEqual(
      Result.fail({ reason: "insufficientFunds", needed: 103, available: 102 }),
    );
  });

  it("reports an unreachable mint", async () => {
    const { wallet } = walletWith({
      price: () =>
        Result.fail(new MintUnreachable({ mint, detail: "offline" })),
    });
    expect(
      await createLightningPayments({ wallet }).quote(fresh, funds(500), 100),
    ).toEqual(Result.fail({ reason: "mintUnreachable" }));
  });

  it("asks a Lightning address for an invoice of the typed amount", async () => {
    const { wallet, priced } = walletWith({});
    const fetchInvoice = vi.fn(async () => "lnbcrt500n1fromaddress");
    const quoted = await createLightningPayments({
      wallet,
      fetchInvoice,
    }).quote(address, funds(500), 50);
    expect(fetchInvoice).toHaveBeenCalledWith("alice@example.com", 50);
    expect(priced).toEqual(["lnbcrt500n1fromaddress"]);
    expect(Result.getOrThrow(quoted).invoice).toBe("lnbcrt500n1fromaddress");
  });

  it("reports a Lightning address that gives no invoice", async () => {
    const { wallet, priced } = walletWith({});
    const quoted = await createLightningPayments({
      wallet,
      fetchInvoice: () => Promise.reject(new Error("unknown user")),
    }).quote(address, funds(500), 50);
    expect(quoted).toEqual(
      Result.fail({ reason: "lnurlFailed", detail: "unknown user" }),
    );
    expect(priced).toEqual([]);
  });
});

describe("paying a confirmed quote", () => {
  const quoteWith = async (wallet: Wallet) => {
    const payments = createLightningPayments({ wallet });
    return {
      payments,
      quote: Result.getOrThrow(await payments.quote(fresh, funds(500), 100)),
    };
  };

  it("melts the quoted invoice, never above the confirmed total", async () => {
    const { wallet, paid } = walletWith({});
    const { payments, quote } = await quoteWith(wallet);
    expect(await payments.pay(quote)).toEqual(
      Result.succeed({ status: "paid", receipt }),
    );
    expect(paid).toEqual([{ cost: quote.cost, invoice }]);
  });

  it("reports a payment the mint has not settled as pending", async () => {
    const { wallet } = walletWith({
      melt: () =>
        Result.fail(
          new PaymentPending({
            mint,
            quoteId,
            operationId: OperationId.make("melt-1"),
            amount: Amount.make(100),
          }),
        ),
    });
    const { payments, quote } = await quoteWith(wallet);
    expect(await payments.pay(quote)).toEqual(
      Result.succeed({ status: "pending" }),
    );
  });

  it.each([
    [
      new PaymentFailed({ mint, quoteId, detail: "no route" }),
      { reason: "paymentFailed", detail: "no route" },
    ],
    [new QuoteExpired({ mint, quoteId }), { reason: "quoteExpired" }],
    [
      new MintRejected({ mint, code: 20005, detail: "quote already paid" }),
      { reason: "mintRejected", detail: "quote already paid" },
    ],
  ])("reports a failed payment: %s", async (error, failure) => {
    const { wallet } = walletWith({ melt: () => Result.fail(error) });
    const { payments, quote } = await quoteWith(wallet);
    expect(await payments.pay(quote)).toEqual(Result.fail(failure));
  });
});

describe("resuming", () => {
  it("settles pending melts and survives a mint that cannot answer", async () => {
    const resume = vi.fn(() => Promise.reject(new Error("offline")));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { wallet } = walletWith({ resume });
    await expect(
      createLightningPayments({ wallet }).resume(),
    ).resolves.toBeUndefined();
    expect(resume).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
