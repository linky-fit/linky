import { createContext, useContext } from "react";
import { halereToSats } from "./money";

export type PaymentMethod = "bank" | "lightning" | "cashu";
export type PaymentStatus = "pending" | "paid" | "cancelled";

/** The customer's Linky profile, known when they pay with Cashu over Nostr. */
export interface DemoPayer {
  readonly name: string;
}

export interface DemoPayment {
  readonly id: string;
  /** The total charged in haléře, the tip included. */
  readonly amountHalere: number;
  readonly tipHalere: number | null;
  /** How it was paid; `null` while nobody paid it. */
  readonly method: PaymentMethod | null;
  readonly status: PaymentStatus;
  readonly vs: string;
  readonly sats: number | null;
  readonly payer: DemoPayer | null;
  readonly createdAt: Date;
  readonly paidAt: Date | null;
}

export type WithdrawalKind = "linky" | "lightning";

export interface DemoWithdrawal {
  readonly id: string;
  readonly kind: WithdrawalKind;
  readonly target: string;
  /** What the recipient got. */
  readonly sats: number;
  readonly feeSats: number;
  readonly at: Date;
}

export interface DemoData {
  readonly payments: readonly DemoPayment[];
  readonly withdrawals: readonly DemoWithdrawal[];
  readonly offerTips: boolean;
}

export type Settlement =
  | { readonly method: "bank" | "lightning" }
  | { readonly method: "cashu"; readonly payer: DemoPayer };

/** The customer who pays the live demo with Cashu from Linky. */
export const livePayer: DemoPayer = { name: "Tereza Malá" };

const seedPayment = (
  id: string,
  nowMs: number,
  minutesAgo: number,
  payment: Pick<DemoPayment, "amountHalere" | "method" | "status" | "vs"> &
    Partial<Pick<DemoPayment, "tipHalere" | "payer">>,
): DemoPayment => {
  const createdAt = new Date(nowMs - minutesAgo * 60_000);
  const paid = payment.status === "paid";
  return {
    id,
    tipHalere: null,
    payer: null,
    ...payment,
    sats:
      paid && payment.method !== "bank" && payment.method !== null
        ? halereToSats(payment.amountHalere)
        : null,
    createdAt,
    paidAt: paid ? new Date(createdAt.getTime() + 40_000) : null,
  };
};

const day = 24 * 60;

/** A shop that has been taking payments since yesterday. */
export const seedData = (nowMs: number): DemoData => ({
  offerTips: true,
  payments: [
    seedPayment("p1", nowMs, 6, {
      amountHalere: 11_000,
      tipHalere: 1_000,
      method: "cashu",
      status: "paid",
      vs: "4820130611",
      payer: { name: "Jana Nováková" },
    }),
    seedPayment("p2", nowMs, 14, {
      amountHalere: 8_900,
      method: "bank",
      status: "paid",
      vs: "4820130598",
    }),
    seedPayment("p3", nowMs, 31, {
      amountHalere: 34_100,
      tipHalere: 3_100,
      method: "bank",
      status: "paid",
      vs: "4820130574",
    }),
    seedPayment("p4", nowMs, 48, {
      amountHalere: 24_900,
      method: "lightning",
      status: "paid",
      vs: "4820130551",
    }),
    seedPayment("p5", nowMs, 63, {
      amountHalere: 4_200,
      method: null,
      status: "cancelled",
      vs: "4820130532",
    }),
    seedPayment("p6", nowMs, 95, {
      amountHalere: 15_500,
      method: "cashu",
      status: "paid",
      vs: "4820130507",
      payer: { name: "Petr Svoboda" },
    }),
    seedPayment("p7", nowMs, day + 45, {
      amountHalere: 230_000,
      method: "bank",
      status: "paid",
      vs: "4820129983",
    }),
    seedPayment("p8", nowMs, day + 120, {
      amountHalere: 56_000,
      tipHalere: 5_000,
      method: "bank",
      status: "paid",
      vs: "4820129901",
    }),
    seedPayment("p9", nowMs, day + 200, {
      amountHalere: 12_900,
      method: "lightning",
      status: "paid",
      vs: "4820129874",
    }),
  ],
  withdrawals: [
    {
      id: "w1",
      kind: "linky",
      target: "npub1q8demo0majitel0kavarna0linky",
      sats: 6_000,
      feeSats: 0,
      at: new Date(nowMs - (day + 30) * 60_000),
    },
    {
      id: "w2",
      kind: "lightning",
      target: "kavarna@example.com",
      sats: 3_998,
      feeSats: 2,
      at: new Date(nowMs - (day + 20) * 60_000),
    },
  ],
});

export const createPayment = (
  data: DemoData,
  payment: Pick<DemoPayment, "id" | "amountHalere" | "tipHalere" | "vs"> & {
    readonly now: Date;
  },
): DemoData => ({
  ...data,
  payments: [
    {
      id: payment.id,
      amountHalere: payment.amountHalere,
      tipHalere: payment.tipHalere,
      vs: payment.vs,
      method: null,
      status: "pending",
      sats: null,
      payer: null,
      createdAt: payment.now,
      paidAt: null,
    },
    ...data.payments,
  ],
});

/** Marks a pending payment paid; a Bitcoin one brings its sats into the wallet. */
export const settlePayment = (
  data: DemoData,
  id: string,
  settlement: Settlement,
  now: Date,
): DemoData => ({
  ...data,
  payments: data.payments.map((payment) =>
    payment.id === id && payment.status === "pending"
      ? {
          ...payment,
          status: "paid",
          method: settlement.method,
          sats:
            settlement.method === "bank"
              ? null
              : halereToSats(payment.amountHalere),
          payer: settlement.method === "cashu" ? settlement.payer : null,
          paidAt: now,
        }
      : payment,
  ),
});

export const cancelPayment = (data: DemoData, id: string): DemoData => ({
  ...data,
  payments: data.payments.map((payment) =>
    payment.id === id && payment.status === "pending"
      ? { ...payment, status: "cancelled" }
      : payment,
  ),
});

/** Bitcoin received minus everything withdrawn, fees included. */
export const balanceSats = (data: DemoData): number =>
  data.payments.reduce((sum, payment) => sum + (payment.sats ?? 0), 0) -
  data.withdrawals.reduce((sum, w) => sum + w.sats + w.feeSats, 0);

export interface WithdrawalQuote {
  readonly kind: WithdrawalKind;
  readonly target: string;
  readonly amountSats: number;
  readonly feeSats: number;
  readonly totalSats: number;
}

/** A made-up Lightning routing fee reserve; a Linky transfer costs nothing in the demo. */
const feeFor = (kind: WithdrawalKind, sats: number) =>
  kind === "lightning" ? Math.max(2, Math.ceil(sats * 0.005)) : 0;

/** Prices a withdrawal; without an amount the whole balance goes, the fee deducted from it. */
export const quoteWithdrawal = (
  kind: WithdrawalKind,
  target: string,
  balance: number,
  amountSats?: number,
): WithdrawalQuote | "insufficient" => {
  const fee = feeFor(kind, amountSats ?? balance);
  const amount = amountSats ?? balance - fee;
  if (amount <= 0 || amount + fee > balance) return "insufficient";
  return {
    kind,
    target,
    amountSats: amount,
    feeSats: fee,
    totalSats: amount + fee,
  };
};

export const withdraw = (
  data: DemoData,
  quote: WithdrawalQuote,
  id: string,
  now: Date,
): DemoData => ({
  ...data,
  withdrawals: [
    {
      id,
      kind: quote.kind,
      target: quote.target,
      sats: quote.amountSats,
      feeSats: quote.feeSats,
      at: now,
    },
    ...data.withdrawals,
  ],
});

export interface DemoActions {
  /** Opens a pending payment, like "Požadovat platbu" after the tip step. */
  readonly requestPayment: (
    amountHalere: number,
    tipHalere: number | null,
  ) => DemoPayment;
  readonly settle: (id: string, settlement: Settlement) => void;
  readonly cancel: (id: string) => void;
  readonly withdraw: (quote: WithdrawalQuote) => void;
  readonly setOfferTips: (offer: boolean) => void;
}

export interface DemoState extends DemoData, DemoActions {
  readonly balanceSats: number;
}

export const DemoContext = createContext<DemoState | undefined>(undefined);

export const useDemo = (): DemoState => {
  const demo = useContext(DemoContext);
  if (!demo) throw new Error("useDemo needs a DemoProvider");
  return demo;
};
