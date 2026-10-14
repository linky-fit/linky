import type { Payment, Receipt, Withdrawal } from "./records";

/** One line of wallet activity: the sats that reached or left the wallet, and the fee among them. */
export type WalletActivity =
  | {
      readonly kind: "payment";
      readonly id: string;
      readonly atSec: number;
      /** What reached the wallet, net of the mint's fee. */
      readonly sats: number;
      /** What the payment asked beyond what arrived. */
      readonly feeSats: number;
      readonly payment: Payment;
    }
  | {
      readonly kind: "receipt";
      readonly id: string;
      readonly atSec: number;
      readonly sats: number;
      readonly feeSats: 0;
      readonly receipt: Receipt;
    }
  | {
      readonly kind: "withdrawal";
      readonly id: string;
      readonly atSec: number;
      /** The amount and every fee; nothing for a failed one, whose funds came back. */
      readonly sats: number;
      readonly feeSats: number;
      readonly withdrawal: Withdrawal;
    };

const receivedBy = (payment: Payment): number | null => {
  if (payment.status !== "paid" || payment.bitcoin === null) return null;
  if (payment.method === "lightning") return payment.bitcoin.sats;
  if (payment.method === "cashu") return payment.cashuReceive?.sats ?? null;
  return null;
};

/**
 * What moved through the wallet, newest first: payments paid in Bitcoin
 * (the minted sats or the received token, net of the mint's fee), receipts
 * (a token that matched no payment, or paid one again) and withdrawals with
 * their fees. Bank payments never touch the wallet.
 */
export const walletActivity = (
  payments: readonly Payment[],
  receipts: readonly Receipt[],
  withdrawals: readonly Withdrawal[],
  limit = 30,
): WalletActivity[] =>
  [
    ...payments.flatMap((payment): WalletActivity[] => {
      const sats = receivedBy(payment);
      return sats === null || payment.bitcoin === null
        ? []
        : [
            {
              kind: "payment",
              id: payment.id,
              atSec: payment.paidAtSec ?? payment.createdAtSec,
              sats,
              feeSats: Math.max(0, payment.bitcoin.sats - sats),
              payment,
            },
          ];
    }),
    ...receipts.map(
      (receipt): WalletActivity => ({
        kind: "receipt",
        id: receipt.id,
        atSec: receipt.receivedAtSec,
        sats: receipt.sats,
        feeSats: 0,
        receipt,
      }),
    ),
    ...withdrawals.map((withdrawal): WalletActivity => {
      const failed = withdrawal.status === "failed";
      const feeSats = failed ? 0 : (withdrawal.feeSats ?? 0);
      return {
        kind: "withdrawal",
        id: withdrawal.id,
        atSec: withdrawal.createdAtSec,
        sats: failed ? 0 : withdrawal.amountSats + feeSats,
        feeSats,
        withdrawal,
      };
    }),
  ]
    .sort((a, b) => b.atSec - a.atSec)
    .slice(0, limit);

/** The sats an activity line added to the balance; negative for a withdrawal. */
export const balanceChange = (item: WalletActivity): number =>
  item.kind === "withdrawal" ? -item.sats : item.sats;

/** A typed amount of whole sats; `null` unless it is a positive integer. */
export const parseSats = (text: string): number | null => {
  const digits = text.replace(/\s/gu, "");
  if (!/^\d{1,15}$/u.test(digits)) return null;
  const sats = Number(digits);
  return sats > 0 ? sats : null;
};
