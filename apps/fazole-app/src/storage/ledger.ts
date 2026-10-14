import { createId, type TransactionId } from "@linky-fit/domain";
import { OperationId } from "@linky-fit/linkshu";
import type { Pubkey } from "@linky-fit/linkstr";
import {
  transactionIdForOperation,
  transactionIdForQuote,
  type TransactionsRepository,
} from "@linky-fit/linksync";
import { MintUrl, QuoteId } from "@linky-fit/linkshu";
import { Effect } from "effect";
import {
  canChangePaymentStatus,
  generateVariableSymbol,
  type BitcoinLeg,
  type CzkAmount,
  type DirectTransfer,
  type Payment,
  type Receipt,
  type Withdrawal,
  type WithdrawalKind,
} from "../domain";
import { nowSeconds } from "../utils/time";
import {
  insertDirectTransfer,
  insertPayment,
  insertReceipt,
  insertWithdrawal,
  readFazoleRecords,
  updatePayment,
  updateWithdrawal,
  type FazoleRecords,
} from "./transactions";

/** How a payment was settled: a bank transfer the merchant confirmed, a minted quote, or a received token. */
export type PaidBy =
  | "bank"
  | "lightning"
  | {
      readonly cashuReceive: {
        readonly operationId: string;
        readonly sats: number;
      };
      /** Who sent the token, when it came over Nostr. */
      readonly payerPubkey?: Pubkey | undefined;
    };

/** Payments, receipts, direct transfers and withdrawals over the transactions repository, as promises. */
export interface Ledger {
  readonly records: () => Promise<FazoleRecords>;
  readonly payment: (id: string) => Promise<Payment | null>;
  /**
   * A new pending payment of `amountCzk`, the tip included; its method is
   * settled by whichever leg the customer pays.
   */
  readonly createPayment: (
    amountCzk: CzkAmount,
    tipCzk?: CzkAmount | null,
  ) => Promise<Payment>;
  readonly attachBitcoinLeg: (
    payment: Payment,
    leg: BitcoinLeg,
  ) => Promise<Payment>;
  /** Drops an expired Lightning quote; the Cashu request stays payable. */
  readonly clearLightningQuote: (payment: Payment) => Promise<void>;
  /** Marks the payment paid when its status still allows it. */
  readonly completePayment: (
    payment: Payment,
    paidBy: PaidBy,
  ) => Promise<boolean>;
  readonly cancelPayment: (payment: Payment) => Promise<boolean>;
  /** Whether the receive `operationId` was already recorded, by a payment, a receipt or a direct transfer. */
  readonly hasReceipt: (operationId: string) => Promise<boolean>;
  /** Records sats a payment's own settlement does not account for, once per receive. */
  readonly recordReceipt: (
    receipt: Omit<Receipt, "id" | "receivedAtSec">,
  ) => Promise<void>;
  /** Records sats that paid no payment, once per receive. */
  readonly recordDirectTransfer: (
    transfer: Omit<DirectTransfer, "id" | "receivedAtSec">,
  ) => Promise<void>;
  readonly createWithdrawal: (withdrawal: {
    readonly kind: WithdrawalKind;
    readonly target: string;
    readonly amountSats: number;
    readonly feeSats: number | null;
    readonly mintUrl: string;
    readonly quoteId?: string | undefined;
    readonly invoice?: string | undefined;
  }) => Promise<Withdrawal>;
  /** Patches the stored row, which another tab may have changed since it was read. */
  readonly updateWithdrawal: (
    id: TransactionId,
    patch: Partial<Pick<Withdrawal, "operationId" | "feeSats" | "amountSats">>,
  ) => Promise<Withdrawal>;
  /** Closes a pending withdrawal; one that already ended is left alone. */
  readonly finishWithdrawal: (
    id: TransactionId,
    outcome:
      | {
          readonly status: "done";
          readonly feeSats?: number | undefined;
          readonly amountSats?: number | undefined;
        }
      | { readonly status: "failed"; readonly error: string },
  ) => Promise<void>;
}

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

export const receiptIdFor = (operationId: string): TransactionId =>
  transactionIdForOperation(OperationId.make(operationId));

export const makeLedger = (transactions: TransactionsRepository): Ledger => {
  const records = () => run(readFazoleRecords(transactions));
  const payment = async (id: string) =>
    (await records()).payments.find((candidate) => candidate.id === id) ?? null;
  const savePayment = async (next: Payment) => {
    await run(updatePayment(transactions, next));
    return next;
  };
  const withdrawal = async (id: TransactionId) =>
    (await records()).withdrawals.find((candidate) => candidate.id === id) ??
    null;
  const saveWithdrawal = async (next: Withdrawal) => {
    await run(updateWithdrawal(transactions, next));
    return next;
  };

  return {
    records,
    payment,
    createPayment: async (amountCzk, tipCzk = null) => {
      const created: Payment = {
        id: createId<"Transaction">(),
        amountCzk,
        tipCzk,
        vs: generateVariableSymbol(),
        status: "pending",
        method: null,
        createdAtSec: nowSeconds(),
        paidAtSec: null,
        bitcoin: null,
        cashuReceive: null,
        payerPubkey: null,
      };
      await run(insertPayment(transactions, created));
      return created;
    },
    attachBitcoinLeg: (current, leg) =>
      savePayment({ ...current, bitcoin: leg }),
    clearLightningQuote: async (current) => {
      if (current.bitcoin === null) return;
      await savePayment({
        ...current,
        bitcoin: { ...current.bitcoin, quoteId: null, invoice: null },
      });
    },
    completePayment: async (current, paidBy) => {
      if (!canChangePaymentStatus(current.status, "paid")) return false;
      await savePayment({
        ...current,
        status: "paid",
        paidAtSec: nowSeconds(),
        ...(typeof paidBy === "string"
          ? { method: paidBy }
          : {
              method: "cashu",
              cashuReceive: paidBy.cashuReceive,
              payerPubkey: paidBy.payerPubkey ?? null,
            }),
      });
      return true;
    },
    cancelPayment: async (current) => {
      if (!canChangePaymentStatus(current.status, "cancelled")) return false;
      await savePayment({ ...current, status: "cancelled" });
      return true;
    },
    hasReceipt: async (operationId) => {
      const { payments, receipts, directTransfers } = await records();
      const id = receiptIdFor(operationId);
      return (
        receipts.some((receipt) => receipt.id === id) ||
        directTransfers.some((transfer) => transfer.id === id) ||
        payments.some(
          (candidate) => candidate.cashuReceive?.operationId === operationId,
        )
      );
    },
    recordReceipt: async (receipt) => {
      await run(
        insertReceipt(transactions, {
          ...receipt,
          id: receiptIdFor(receipt.operationId),
          receivedAtSec: nowSeconds(),
        }),
      );
    },
    recordDirectTransfer: async (transfer) => {
      await run(
        insertDirectTransfer(transactions, {
          ...transfer,
          id: receiptIdFor(transfer.operationId),
          receivedAtSec: nowSeconds(),
        }),
      );
    },
    createWithdrawal: async ({ quoteId, invoice, ...fields }) => {
      const mint = MintUrl.make(fields.mintUrl);
      const created: Withdrawal = {
        ...fields,
        // A melt's row is the one Linky derives from its quote, so a resume on any device lands on it.
        id:
          quoteId === undefined
            ? createId<"Transaction">()
            : transactionIdForQuote("melt", mint, QuoteId.make(quoteId)),
        status: "pending",
        createdAtSec: nowSeconds(),
        quoteId: quoteId ?? null,
        invoice: invoice ?? null,
        operationId: null,
        error: null,
      };
      await run(insertWithdrawal(transactions, created));
      return created;
    },
    updateWithdrawal: async (id, patch) => {
      const current = await withdrawal(id);
      if (current === null) throw new Error(`no withdrawal ${id}`);
      return saveWithdrawal({ ...current, ...patch });
    },
    finishWithdrawal: async (id, outcome) => {
      const current = await withdrawal(id);
      if (current?.status !== "pending") return;
      await saveWithdrawal(
        outcome.status === "done"
          ? {
              ...current,
              status: "done",
              ...(outcome.feeSats === undefined
                ? {}
                : { feeSats: outcome.feeSats }),
              ...(outcome.amountSats === undefined
                ? {}
                : { amountSats: outcome.amountSats }),
            }
          : { ...current, status: "failed", error: outcome.error },
      );
    },
  };
};
