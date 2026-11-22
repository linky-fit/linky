import type { Pubkey } from "@linky-fit/linkstr";
import { walletActivity, type WalletActivity } from "./activity";
import { CzkAmount, czkToSats, satsToCzk } from "./money";
import type { DirectTransfer, Payment, Receipt, Withdrawal } from "./records";

/**
 * Cash a Linky user handed the merchant, owed back in bitcoin: every sat
 * that reaches the wallet from then on goes to them until the CZK amount
 * is repaid. One at a time.
 */
export interface Pledge {
  readonly pubkey: Pubkey;
  /** The address the merchant typed, e.g. `hynek@linky.fit`; `null` for a bare key. */
  readonly address: string | null;
  readonly amountCzk: CzkAmount;
  readonly createdAtSec: number;
}

/** What a withdrawal repaid of the pledge, and the inflows it forwarded. */
export interface PledgeRepayment {
  readonly czk: CzkAmount;
  /** The wallet activity ids of the inflows the withdrawal forwarded. */
  readonly sources: readonly string[];
  /** Deterministic linkshu envelope key holding this repayment's proofs; absent on legacy sends. */
  readonly envelopeKey?: string | undefined;
  /** What remained of the pledge after this repayment, so retries send the same chat text. */
  readonly remainingCzk?: CzkAmount | undefined;
}

/** Whether `withdrawal` belongs to `pledge`: by envelope key when present, else by time for legacy sends. */
const belongsToPledge = (pledge: Pledge, withdrawal: Withdrawal): boolean =>
  withdrawal.pledge !== null &&
  (withdrawal.pledge.envelopeKey !== undefined
    ? isEnvelopeForPledge(pledge, withdrawal.pledge.envelopeKey)
    : withdrawal.createdAtSec >= pledge.createdAtSec);

/** The withdrawals that repay the pledge, failed ones excluded: their sats came back. */
const repayments = (pledge: Pledge, withdrawals: readonly Withdrawal[]) =>
  withdrawals.filter(
    (withdrawal) =>
      withdrawal.status !== "failed" && belongsToPledge(pledge, withdrawal),
  );

/** What the pledge's withdrawals repaid, the pending ones included. */
export const pledgeRepaidCzk = (
  pledge: Pledge,
  withdrawals: readonly Withdrawal[],
): CzkAmount =>
  CzkAmount.make(
    Math.min(
      pledge.amountCzk,
      repayments(pledge, withdrawals).reduce(
        (total, withdrawal) => total + (withdrawal.pledge?.czk ?? 0),
        0,
      ),
    ),
  );

export const pledgeRemainingCzk = (
  pledge: Pledge,
  withdrawals: readonly Withdrawal[],
): CzkAmount =>
  CzkAmount.make(pledge.amountCzk - pledgeRepaidCzk(pledge, withdrawals));

/** Whether the pledge is repaid and every repayment reached the relay, so it can close. */
export const isPledgeSettled = (
  pledge: Pledge,
  withdrawals: readonly Withdrawal[],
): boolean =>
  pledgeRemainingCzk(pledge, withdrawals) === 0 &&
  repayments(pledge, withdrawals).every(
    (withdrawal) => withdrawal.status === "done",
  );

/** A failed forward is tried again after this long, not on every change. */
export const FORWARD_RETRY_SEC = 10 * 60;

/**
 * The sats that reached the wallet since the pledge and no live repayment
 * forwarded yet, oldest first. Inflows whose forward failed less than
 * `FORWARD_RETRY_SEC` before `nowSec` wait, so a mint that keeps refusing
 * is not asked on every change.
 */
export const unforwardedInflows = (
  pledge: Pledge,
  records: {
    readonly payments: readonly Payment[];
    readonly receipts: readonly Receipt[];
    readonly directTransfers: readonly DirectTransfer[];
    readonly withdrawals: readonly Withdrawal[];
  },
  nowSec: number,
): WalletActivity[] => {
  const heldSources = new Set<string>();
  const heldKeys = new Set<string>();
  for (const withdrawal of records.withdrawals) {
    if (
      !belongsToPledge(pledge, withdrawal) ||
      withdrawal.pledge === null ||
      (withdrawal.status === "failed" &&
        withdrawal.createdAtSec <= nowSec - FORWARD_RETRY_SEC)
    ) {
      continue;
    }
    for (const source of withdrawal.pledge.sources) heldSources.add(source);
    if (withdrawal.pledge.envelopeKey !== undefined) {
      heldKeys.add(withdrawal.pledge.envelopeKey);
    }
  }
  return walletActivity(records, Number.POSITIVE_INFINITY)
    .filter(
      (item) =>
        item.kind !== "withdrawal" &&
        item.sats > 0 &&
        item.atSec >= pledge.createdAtSec &&
        !heldSources.has(item.id) &&
        !heldKeys.has(pledgeEnvelopeKey(pledge, item)),
    )
    .reverse();
};

/**
 * Stable identity for an inflow across terminals, even if one terminal
 * classified a NUT-18 token as a paid `payment` and another recorded the same
 * receive as a `direct` transfer or `receipt` before the payment row synced.
 */
export const inflowEnvelopeSource = (inflow: WalletActivity): string => {
  switch (inflow.kind) {
    case "payment":
      return inflow.payment.cashuReceive?.operationId ?? inflow.payment.id;
    case "receipt":
      return inflow.receipt.operationId;
    case "direct":
      return inflow.transfer.operationId;
    case "withdrawal":
      return inflow.id;
  }
};

const pledgeEnvelopePrefix = (pledge: Pledge): string =>
  `fazole:pledge:${pledge.createdAtSec}:`;

/**
 * Deterministic linkshu envelope key for forwarding `inflow` under `pledge`.
 * Tied 1-to-1 to the inflow's underlying receive/payment so every terminal
 * derives the same key at the inflow's mint regardless of sync order or
 * receive classification.
 */
export const pledgeEnvelopeKey = (
  pledge: Pledge,
  inflow: WalletActivity,
): string => `${pledgeEnvelopePrefix(pledge)}${inflowEnvelopeSource(inflow)}`;

/** Whether `envelopeKey` belongs to `pledge` (and not an earlier pledge to the same person). */
export const isEnvelopeForPledge = (
  pledge: Pledge,
  envelopeKey: string | undefined,
): boolean =>
  envelopeKey !== undefined &&
  envelopeKey.startsWith(pledgeEnvelopePrefix(pledge));

/** The mint an inflow arrived at, so every terminal opens its envelope at the same mint. */
export const inflowMint = (
  inflow: WalletActivity,
  payments: readonly Payment[],
): string | null => {
  switch (inflow.kind) {
    case "payment":
      return inflow.payment.bitcoin?.mintUrl ?? null;
    case "direct":
      return inflow.transfer.mintUrl;
    case "receipt":
      return (
        inflow.receipt.mintUrl ??
        (inflow.receipt.paymentId === null
          ? null
          : (payments.find((payment) => payment.id === inflow.receipt.paymentId)
              ?.bitcoin?.mintUrl ?? null))
      );
    case "withdrawal":
      return null;
  }
};

/** The CZK/BTC rate stored on the inflow itself, when one was captured on arrival. */
export const inflowRate = (
  inflow: WalletActivity,
  payments: readonly Payment[],
): number | null => {
  switch (inflow.kind) {
    case "payment":
      return inflow.payment.bitcoin?.czkPerBtc ?? null;
    case "direct":
      return inflow.transfer.czkPerBtc;
    case "receipt":
      return inflow.receipt.paymentId === null
        ? null
        : (payments.find((payment) => payment.id === inflow.receipt.paymentId)
            ?.bitcoin?.czkPerBtc ?? null);
    case "withdrawal":
      return null;
  }
};

/** One repayment: the sats to forward and what they repay. */
export interface ForwardPlan {
  readonly amountSats: number;
  readonly czk: CzkAmount;
}

/**
 * Sizes a repayment: the inflow, or as much of it as the remaining debt
 * is worth at the rate. The last repayment closes the debt exactly, so a
 * rounding sat never leaves a few haléře owed.
 */
export const planForward = (
  remainingCzk: CzkAmount,
  inflowSats: number,
  czkPerBtc: number,
): ForwardPlan | null => {
  if (remainingCzk <= 0 || inflowSats <= 0) return null;
  const owedSats = czkToSats(remainingCzk, czkPerBtc);
  return inflowSats >= owedSats
    ? { amountSats: owedSats, czk: remainingCzk }
    : {
        amountSats: inflowSats,
        czk: CzkAmount.make(
          Math.min(remainingCzk, satsToCzk(inflowSats, czkPerBtc)),
        ),
      };
};

/** What a repayment of `amountSats` is worth of the debt when it had to shrink to `amountSats`. */
export const repaymentCzkFor = (
  plan: ForwardPlan,
  amountSats: number,
  czkPerBtc: number,
): CzkAmount =>
  amountSats >= plan.amountSats
    ? plan.czk
    : CzkAmount.make(Math.min(plan.czk, satsToCzk(amountSats, czkPerBtc)));

const czkText = (amount: CzkAmount): string =>
  new Intl.NumberFormat("cs-CZ", {
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);

const satsText = (sats: number): string =>
  new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 }).format(sats);

/** Fixed Czech text for the contact's Linky chat, whatever the app's language: the wallet holds the amount, cash is asked for it. */
export const exchangeRequestMessage = (
  shopName: string | null,
  amountCzk: CzkAmount,
): string =>
  `${shopName ?? "Podnik bez názvu"} žádá o směnu ${czkText(amountCzk)} Kč: hotovost za bitcoin.`;

/** Fixed Czech text for the pledger's Linky chat, whatever the app's language. */
export const pledgeOpenedMessage = (amountCzk: CzkAmount): string =>
  `Přijato do zástavy ${czkText(amountCzk)} Kč.`;

export const pledgeRepaymentMessage = (
  sats: number,
  czk: CzkAmount,
  remainingCzk: CzkAmount,
  amountCzk: CzkAmount,
): string =>
  remainingCzk > 0
    ? `Ze zástavy posláno ${satsText(sats)} sat (≈ ${czkText(czk)} Kč). Zbývá doplatit ${czkText(remainingCzk)} Kč.`
    : `Ze zástavy posláno ${satsText(sats)} sat (≈ ${czkText(czk)} Kč). Zástava ${czkText(amountCzk)} Kč je splacená.`;
