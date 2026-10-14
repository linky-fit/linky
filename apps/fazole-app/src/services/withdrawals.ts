import {
  Amount,
  Bolt11Invoice,
  fetchLnurlInvoiceForTarget,
  Melt,
  MeltDraft,
  Send,
  SendDraft,
  type MeltCost,
  type MeltError,
  type MeltReceipt,
  type MintUrl,
  type SendError,
} from "@linky-fit/linkshu";
import { decodeNpub, type Pubkey } from "@linky-fit/linkstr";
import { Effect, Result } from "effect";
import type { Withdrawal, WithdrawTarget } from "../domain";
import type { Ledger } from "../storage/ledger";
import { nowSeconds } from "../utils/time";
import type { Nostr } from "./nostr";
import { serialQueue } from "./serial";
import type { Wallet } from "./wallet";

export type WithdrawFailure =
  /** The Lightning address did not hand out an invoice. */
  | "lnurl-failed"
  /** The balance does not cover the amount and its fees. */
  | "insufficient-funds"
  /** Fees would take the whole amount. */
  | "amount-too-small"
  | "mint-unreachable"
  | "payment-failed";

/**
 * A priced withdrawal, shown for confirmation before it runs: what reaches
 * the recipient, the most the fees can add and the most leaving the wallet.
 */
export interface WithdrawalQuote {
  readonly target: WithdrawTarget;
  /** The mint the sats leave from. */
  readonly mint: MintUrl;
  /** What the recipient gets: the invoice amount, or the token's value. */
  readonly amountSats: number;
  /** The most the fees can take on top of `amountSats`. */
  readonly feeSats: number;
  /** `amountSats + feeSats`: never more leaves the wallet. */
  readonly totalSats: number;
  /** The amount was sized so the whole balance, fees included, goes out. */
  readonly wholeBalance: boolean;
  readonly plan:
    | {
        readonly kind: "melt";
        readonly invoice: Bolt11Invoice;
        readonly cost: MeltCost;
      }
    | { readonly kind: "send"; readonly to: Pubkey };
}

/** Where an executed withdrawal stands: paid, or still with the mint or the outbox. */
export interface WithdrawalOutcome {
  readonly status: "done" | "pending";
  readonly withdrawal: Withdrawal;
}

export interface Withdrawals {
  /**
   * Prices a withdrawal to `target`. Without `amountSats` it sends the whole
   * balance with the fees deducted from it; an invoice's amount is fixed.
   */
  readonly quote: (
    target: WithdrawTarget,
    options?: { readonly amountSats?: number | undefined },
  ) => Promise<Result.Result<WithdrawalQuote, WithdrawFailure>>;
  /** Runs a confirmed quote and records it as an `out` transaction with its fee. */
  readonly execute: (
    quote: WithdrawalQuote,
  ) => Promise<Result.Result<WithdrawalOutcome, WithdrawFailure>>;
  /** Settles withdrawals a reload interrupted; call when the store is hydrated. */
  readonly resume: () => Promise<void>;
}

const failureOf = (error: MeltError | SendError): WithdrawFailure => {
  switch (error._tag) {
    case "InsufficientFunds":
      return "insufficient-funds";
    case "AmountConsumedByFee":
      return "amount-too-small";
    case "MintUnreachable":
    case "CounterLockTimeout":
      return "mint-unreachable";
    default:
      return "payment-failed";
  }
};

/** Every fee a paid melt took from the balance beyond the invoice. */
const meltFee = (receipt: MeltReceipt) => receipt.feePaid + receipt.swapFee;

/** NUT-02: a swap over `proofs` inputs costs `ceil(ppk * proofs / 1000)`. */
const swapFeeFor = (inputFeePpk: number | null, proofs: number) =>
  Math.ceil(((inputFeePpk ?? 0) * proofs) / 1000);

// A Lightning address prices each amount anew; a few rounds settle the fee reserve.
const MAX_SIZING_ROUNDS = 6;
// A whole-balance send whose fee estimate was short steps down this far.
const SEND_STEP_DOWNS = 3;

const WITHDRAWAL_REF = "fazole.withdrawal:";
// Long enough for another tab or device to link a send it just made to its row.
const RESUME_GRACE_SEC = 120;

export const createWithdrawals = ({
  ledger,
  nostr,
  wallet,
}: {
  readonly ledger: Ledger;
  readonly nostr: Nostr;
  readonly wallet: Wallet;
}): Withdrawals => {
  const refOf = (id: string) => `${WITHDRAWAL_REF}${id}`;
  const serially = serialQueue("withdrawal");

  const priceMelt = (mint: MintUrl, invoice: Bolt11Invoice) =>
    wallet.run(
      Effect.flatMap(Melt, (melt) =>
        Effect.flatMap(melt.quote(new MeltDraft({ mint, invoice })), melt.cost),
      ),
    );

  const meltQuote = (
    target: WithdrawTarget,
    mint: MintUrl,
    cost: MeltCost,
    invoice: Bolt11Invoice,
    wholeBalance: boolean,
  ): WithdrawalQuote => ({
    target,
    mint,
    amountSats: cost.quote.amount,
    feeSats: cost.maxTotal - cost.quote.amount,
    totalSats: cost.maxTotal,
    wholeBalance,
    plan: { kind: "melt", invoice, cost },
  });

  const quoteInvoice = async (
    target: Extract<WithdrawTarget, { kind: "lightning_invoice" }>,
    source: { readonly mint: MintUrl; readonly sats: number },
  ): Promise<Result.Result<WithdrawalQuote, WithdrawFailure>> => {
    const cost = await priceMelt(source.mint, target.invoice);
    if (Result.isFailure(cost)) return Result.fail(failureOf(cost.failure));
    return cost.success.maxTotal > source.sats
      ? Result.fail("insufficient-funds")
      : Result.succeed(
          meltQuote(target, source.mint, cost.success, target.invoice, false),
        );
  };

  const quoteAddress = async (
    target: Extract<WithdrawTarget, { kind: "lightning_address" }>,
    source: { readonly mint: MintUrl; readonly sats: number },
    requested: number | undefined,
  ): Promise<Result.Result<WithdrawalQuote, WithdrawFailure>> => {
    let amount = requested ?? source.sats;
    for (let round = 0; round < MAX_SIZING_ROUNDS && amount > 0; round += 1) {
      let invoice: Bolt11Invoice;
      try {
        const { pr } = await fetchLnurlInvoiceForTarget(target.target, amount);
        invoice = Bolt11Invoice.make(pr);
      } catch (error) {
        console.warn("[fazole] LNURL invoice failed", error);
        return Result.fail("lnurl-failed");
      }
      const cost = await priceMelt(source.mint, invoice);
      if (Result.isFailure(cost)) return Result.fail(failureOf(cost.failure));
      const over = cost.success.maxTotal - source.sats;
      if (over <= 0) {
        return Result.succeed(
          meltQuote(
            target,
            source.mint,
            cost.success,
            invoice,
            requested === undefined,
          ),
        );
      }
      if (requested !== undefined) return Result.fail("insufficient-funds");
      amount -= over;
    }
    return Result.fail(amount > 0 ? "insufficient-funds" : "amount-too-small");
  };

  const quoteSend = async (
    target: Extract<WithdrawTarget, { kind: "cashu_chat" }>,
    source: { readonly mint: MintUrl; readonly sats: number },
    requested: number | undefined,
  ): Promise<Result.Result<WithdrawalQuote, WithdrawFailure>> => {
    // Sending all of it swaps every proof, so the fee of all of them is the most a send can cost.
    const feeSats = swapFeeFor(
      await wallet.inputFeePpk(source.mint),
      await wallet.availableProofCount(source.mint),
    );
    const amountSats = requested ?? source.sats - feeSats;
    if (amountSats <= 0) return Result.fail("amount-too-small");
    if (amountSats + feeSats > source.sats)
      return Result.fail("insufficient-funds");
    return Result.succeed({
      target,
      mint: source.mint,
      amountSats,
      feeSats,
      totalSats: amountSats + feeSats,
      wholeBalance: requested === undefined,
      plan: { kind: "send", to: target.pubkey },
    });
  };

  const settleMelt = async (
    withdrawal: Withdrawal,
    outcome: Result.Result<MeltReceipt, MeltError>,
  ): Promise<Result.Result<WithdrawalOutcome, WithdrawFailure>> => {
    if (Result.isSuccess(outcome)) {
      await ledger.finishWithdrawal(withdrawal.id, {
        status: "done",
        amountSats: outcome.success.paidAmount,
        feeSats: meltFee(outcome.success),
      });
      return Result.succeed({
        status: "done",
        withdrawal: {
          ...withdrawal,
          status: "done",
          amountSats: outcome.success.paidAmount,
          feeSats: meltFee(outcome.success),
        },
      });
    }
    if (outcome.failure._tag === "PaymentPending") {
      return Result.succeed({ status: "pending", withdrawal });
    }
    await ledger.finishWithdrawal(withdrawal.id, {
      status: "failed",
      error: outcome.failure._tag,
    });
    return Result.fail(failureOf(outcome.failure));
  };

  const executeMelt = async (
    quote: WithdrawalQuote,
    plan: Extract<WithdrawalQuote["plan"], { kind: "melt" }>,
  ) => {
    const { cost, invoice } = plan;
    const withdrawal = await ledger.createWithdrawal({
      kind: quote.target.kind,
      target:
        quote.target.kind === "lightning_address"
          ? quote.target.target
          : invoice,
      amountSats: cost.quote.amount,
      feeSats: null,
      mintUrl: cost.quote.mint,
      quoteId: cost.quote.quoteId,
      invoice,
    });
    const paid = await wallet.run(
      Effect.flatMap(Melt, (melt) =>
        melt.melt(
          new MeltDraft({
            mint: cost.quote.mint,
            invoice,
            quoteId: cost.quote.quoteId,
            maxTotal: cost.maxTotal,
          }),
        ),
      ),
    );
    return settleMelt(withdrawal, paid);
  };

  const sendOnce = (mint: MintUrl, amount: number) =>
    wallet.run(
      Effect.flatMap(Send, (send) =>
        send.send(
          new SendDraft({
            mint,
            amount: Amount.make(amount),
            produceAs: "pending",
          }),
        ),
      ),
    );

  /** Sends `amount`, stepping down a sat at a time when a whole-balance estimate came up short. */
  const sendSized = async (quote: WithdrawalQuote) => {
    const steps = quote.wholeBalance ? SEND_STEP_DOWNS : 0;
    let sent = await sendOnce(quote.mint, quote.amountSats);
    for (let step = 1; step <= steps; step += 1) {
      if (
        Result.isSuccess(sent) ||
        sent.failure._tag !== "InsufficientFunds" ||
        quote.amountSats - step <= 0
      )
        break;
      sent = await sendOnce(quote.mint, quote.amountSats - step);
    }
    return sent;
  };

  const executeSend = (quote: WithdrawalQuote, to: Pubkey) =>
    serially(
      async (): Promise<Result.Result<WithdrawalOutcome, WithdrawFailure>> => {
        // Stored first, so a reload at any later step leaves a row `resume` settles.
        const created = await ledger.createWithdrawal({
          kind: "cashu_chat",
          target: quote.target.kind === "cashu_chat" ? quote.target.npub : "",
          amountSats: quote.amountSats,
          feeSats: null,
          mintUrl: quote.mint,
        });
        const sent = await sendSized(quote);
        if (Result.isFailure(sent)) {
          await ledger.finishWithdrawal(created.id, {
            status: "failed",
            error: sent.failure._tag,
          });
          return Result.fail(failureOf(sent.failure));
        }
        const { operationId, tokenText, feePaid, amount } = sent.success;
        const withdrawal = await ledger.updateWithdrawal(created.id, {
          operationId,
          amountSats: amount,
          feeSats: feePaid,
        });
        try {
          await nostr.sendToken(to, tokenText, refOf(withdrawal.id));
        } catch (error) {
          console.warn("[fazole] Linky withdrawal not queued", error);
          // Still pending if the token stays out; the next start queues it.
          if (await wallet.returnSend(operationId)) {
            await ledger.finishWithdrawal(withdrawal.id, {
              status: "failed",
              error: "NotQueued",
            });
          }
          return Result.fail("payment-failed");
        }
        return Result.succeed({ status: "pending", withdrawal });
      },
    ).then((outcome) => outcome ?? Result.fail("payment-failed"));

  nostr.onOutboxResult(WITHDRAWAL_REF, async (result) => {
    const withdrawal = (await ledger.records()).withdrawals.find(
      ({ id }) => refOf(id) === result.ref,
    );
    const operationId = withdrawal?.operationId;
    if (!withdrawal || !operationId) return;
    if (result._tag === "OutboxJobSucceeded") {
      await wallet.forgetSend(operationId);
      await ledger.finishWithdrawal(withdrawal.id, { status: "done" });
      const to = decodeNpub(withdrawal.target);
      if (to) await nostr.sendPaymentNotice(to);
      return;
    }
    await wallet.returnSend(operationId);
    await ledger.finishWithdrawal(withdrawal.id, {
      status: "failed",
      error: result.detail || result.reason,
    });
  });

  /**
   * Settles Linky withdrawals a reload interrupted: a token that never
   * reached the outbox is queued now, one cut off before its send was linked
   * fails, and a send no live withdrawal holds goes back to the balance.
   * Rows and sends younger than the grace period are left to their maker.
   */
  const resumeSends = () =>
    serially(async () => {
      const graceStartSec = nowSeconds() - RESUME_GRACE_SEC;
      const { withdrawals } = await ledger.records();
      const sends = await wallet.pendingSends();
      const queued = await nostr.queuedRefs();
      for (const withdrawal of withdrawals) {
        if (withdrawal.kind !== "cashu_chat" || withdrawal.status !== "pending")
          continue;
        if (withdrawal.operationId === null) {
          if (withdrawal.createdAtSec <= graceStartSec) {
            await ledger.finishWithdrawal(withdrawal.id, {
              status: "failed",
              error: "Interrupted",
            });
          }
          continue;
        }
        const send = sends.find(({ id }) => id === withdrawal.operationId);
        const to = decodeNpub(withdrawal.target);
        if (send && to && !queued.has(refOf(withdrawal.id))) {
          await nostr.sendToken(to, send.tokenText, refOf(withdrawal.id));
        }
      }
      const live = new Set(
        withdrawals.flatMap(({ status, operationId }) =>
          status === "failed" || operationId === null ? [] : [operationId],
        ),
      );
      for (const send of sends) {
        if (!live.has(send.id) && send.createdAt <= graceStartSec)
          await wallet.returnSend(send.id);
      }
    });

  const resumeMelts = async () => {
    const results = await wallet.run(
      Effect.flatMap(Melt, (melt) => melt.resumePending),
    );
    if (Result.isFailure(results)) return;
    const { withdrawals } = await ledger.records();
    for (const result of results.success) {
      const withdrawal = withdrawals.find(
        (candidate) =>
          candidate.status === "pending" &&
          candidate.quoteId === result.quoteId,
      );
      if (withdrawal === undefined) continue;
      if (result.status === "paid") {
        await ledger.finishWithdrawal(withdrawal.id, {
          status: "done",
          ...(result.receipt ? { feeSats: meltFee(result.receipt) } : {}),
        });
      } else if (result.status === "unpaid") {
        await ledger.finishWithdrawal(withdrawal.id, {
          status: "failed",
          error: "PaymentFailed",
        });
      }
    }
  };

  return {
    quote: async (target, options) => {
      const source = await wallet.richestMint();
      if (source === null) return Result.fail("insufficient-funds");
      const requested = options?.amountSats;
      switch (target.kind) {
        case "lightning_invoice":
          return quoteInvoice(target, source);
        case "lightning_address":
          return quoteAddress(target, source, requested);
        case "cashu_chat":
          return quoteSend(target, source, requested);
      }
    },
    execute: (quote) =>
      quote.plan.kind === "melt"
        ? executeMelt(quote, quote.plan)
        : executeSend(quote, quote.plan.to),
    resume: async () => {
      await Promise.all([resumeSends(), resumeMelts()]);
    },
  };
};
