import {
  Bolt11Invoice,
  fetchLnurlInvoiceForTarget,
  type MeltCost,
  type MeltError,
  type MeltReceipt,
} from "@linky-fit/linkshu";
import { Result } from "effect";
import type { MintFunds, LightningTarget } from "../domain/wallet";
import { nowSeconds } from "../utils/time";
import type { Wallet } from "./wallet";

export type LightningFailure =
  /** The Lightning address did not hand out an invoice. */
  | { readonly reason: "lnurlFailed"; readonly detail: string }
  | { readonly reason: "invoiceExpired" }
  /** The melt quote ran out while waiting for confirmation. */
  | { readonly reason: "quoteExpired" }
  | {
      readonly reason: "insufficientFunds";
      readonly needed: number;
      readonly available: number;
    }
  | { readonly reason: "mintUnreachable" }
  | { readonly reason: "mintRejected"; readonly detail: string }
  /** The Lightning payment failed; the balance is intact. */
  | { readonly reason: "paymentFailed"; readonly detail: string | null };

/** A priced Lightning payment, shown for confirmation before it runs. */
export interface LightningQuote {
  readonly target: LightningTarget;
  readonly invoice: Bolt11Invoice;
  /** `cost.quote.amount` reaches the recipient; never more than `cost.maxTotal` leaves the wallet. */
  readonly cost: MeltCost;
}

export type LightningOutcome =
  | { readonly status: "paid"; readonly receipt: MeltReceipt }
  /** The mint has not settled it yet; `resume` does on the next start. */
  | { readonly status: "pending" };

export interface LightningPayments {
  /** Prices paying `target` from `source`; `amountSats` sizes a Lightning address's invoice. */
  readonly quote: (
    target: LightningTarget,
    source: MintFunds,
    amountSats: number,
  ) => Promise<Result.Result<LightningQuote, LightningFailure>>;
  /** Pays a confirmed quote. */
  readonly pay: (
    quote: LightningQuote,
  ) => Promise<Result.Result<LightningOutcome, LightningFailure>>;
  /** Settles payments a reload or a lost mint answer left pending; call once the wallet is hydrated. */
  readonly resume: () => Promise<void>;
}

const failureOf = (error: MeltError): LightningFailure => {
  switch (error._tag) {
    case "InsufficientFunds":
      return {
        reason: "insufficientFunds",
        needed: error.required,
        available: error.available,
      };
    case "QuoteExpired":
      return { reason: "quoteExpired" };
    case "MintUnreachable":
    case "CounterLockTimeout":
      return { reason: "mintUnreachable" };
    case "MintRejected":
      return { reason: "mintRejected", detail: error.detail };
    case "PaymentFailed":
      return { reason: "paymentFailed", detail: error.detail };
    case "PaymentPending":
      return { reason: "paymentFailed", detail: null };
  }
};

/** Asks a Lightning address for an invoice of `amountSats`. */
export type FetchInvoice = (
  target: string,
  amountSats: number,
) => Promise<string>;

const fetchLnurlInvoice: FetchInvoice = async (target, amountSats) =>
  (await fetchLnurlInvoiceForTarget(target, amountSats)).pr;

export const createLightningPayments = ({
  wallet,
  fetchInvoice = fetchLnurlInvoice,
}: {
  readonly wallet: Wallet;
  readonly fetchInvoice?: FetchInvoice | undefined;
}): LightningPayments => {
  const invoiceFor = async (
    target: LightningTarget,
    amountSats: number,
  ): Promise<Result.Result<Bolt11Invoice, LightningFailure>> => {
    if (target.kind === "invoice") {
      return target.expiresAtSec <= nowSeconds()
        ? Result.fail({ reason: "invoiceExpired" })
        : Result.succeed(target.invoice);
    }
    try {
      return Result.succeed(
        Bolt11Invoice.make(await fetchInvoice(target.target, amountSats)),
      );
    } catch (error) {
      return Result.fail({
        reason: "lnurlFailed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return {
    quote: async (target, source, amountSats) => {
      const invoice = await invoiceFor(target, amountSats);
      if (Result.isFailure(invoice)) return Result.fail(invoice.failure);
      const cost = await wallet.priceMelt(source.mint, invoice.success);
      if (Result.isFailure(cost)) return Result.fail(failureOf(cost.failure));
      return cost.success.maxTotal > source.sats
        ? Result.fail({
            reason: "insufficientFunds",
            needed: cost.success.maxTotal,
            available: source.sats,
          })
        : Result.succeed({
            target,
            invoice: invoice.success,
            cost: cost.success,
          });
    },
    pay: async (quote) => {
      const paid = await wallet.melt(quote.cost, quote.invoice);
      if (Result.isSuccess(paid))
        return Result.succeed({ status: "paid", receipt: paid.success });
      return paid.failure._tag === "PaymentPending"
        ? Result.succeed({ status: "pending" })
        : Result.fail(failureOf(paid.failure));
    },
    resume: async () => {
      try {
        await wallet.resumeMelts();
      } catch (error) {
        console.warn("[onchain-operator] pending payments not resumed", error);
      }
    },
  };
};
