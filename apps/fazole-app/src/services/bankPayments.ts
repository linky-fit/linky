import { Result } from "effect";
import {
  bankAccountIdFor,
  bankHistoryRange,
  bankTransferPaying,
  type CzechIban,
  type Payment,
} from "../domain";
import type { Ledger } from "../storage/ledger";
import {
  parseMonetaTokenInput,
  type MonetaConnection,
} from "../storage/monetaSetting";
import { nowSeconds } from "../utils/time";
import type { MonetaApi } from "./monetaApi";

/** Why a token could not be connected; an unreachable bank is worth a retry, the others need a different token or account. */
export type ConnectFailure =
  | "invalid-token"
  | "no-account"
  | "unauthorized"
  | "unreachable"
  | "account-not-visible";

/** What the bank answers while a payment is watched; the payment itself turns paid in the ledger. */
export type BankWatchState = "watching" | "unreachable" | "unauthorized";

/**
 * Confirms bank QR payments through the bank's API: a payment turns paid
 * once the account's history lists a transfer with its variable symbol and
 * at least its amount, as the Lightning and Cashu legs do through the mint.
 */
export interface BankPayments {
  /** Checks the token against the bank, finds the shop's account among those it sees and stores both. */
  readonly connect: (
    token: string,
  ) => Promise<Result.Result<MonetaConnection, ConnectFailure>>;
  readonly disconnect: () => Promise<void>;
  /**
   * Polls the bank for the payment's transfer until the returned function
   * is called, reporting the bank's answers to `onState`; several watchers
   * share one poll.
   */
  readonly watch: (
    paymentId: string,
    onState: (state: BankWatchState) => void,
  ) => () => void;
  readonly stop: () => void;
}

const POLL_MS = 4_000;
const BACKOFF_MS = 20_000;

export const createBankPayments = ({
  ledger,
  api,
  connection,
  saveConnection,
  shopIban,
  pollMs = POLL_MS,
  backoffMs = BACKOFF_MS,
}: {
  readonly ledger: Ledger;
  readonly api: MonetaApi;
  readonly connection: () => Promise<MonetaConnection | null>;
  readonly saveConnection: (
    connection: MonetaConnection | null,
  ) => Promise<void>;
  readonly shopIban: () => Promise<CzechIban | null>;
  readonly pollMs?: number;
  /** The pause after the bank did not answer. */
  readonly backoffMs?: number;
}): BankPayments => {
  const watchers = new Map<string, Set<(state: BankWatchState) => void>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let polling = false;
  let stopped = false;

  const report = (state: BankWatchState) => {
    for (const listeners of watchers.values()) {
      for (const listener of listeners) listener(state);
    }
  };

  const schedule = (delayMs: number) => {
    if (timer !== null || stopped || watchers.size === 0) return;
    timer = setTimeout(() => {
      timer = null;
      void poll();
    }, delayMs);
  };

  /** The watched payments a transfer can still pay: a cancelled one too, as a late transfer still counts. */
  const openPayments = async (): Promise<Payment[]> => {
    const payments = await Promise.all(
      [...watchers.keys()].map((id) => ledger.payment(id)),
    );
    return payments.filter(
      (payment): payment is Payment =>
        payment !== null && payment.status !== "paid",
    );
  };

  /** One look at the bank for every watched payment; `null` ends the polling until the next watcher comes. */
  const lookOnce = async (): Promise<number | null> => {
    const current = await connection();
    if (current === null) {
      report("unauthorized");
      return null;
    }
    const payments = await openPayments();
    if (payments.length === 0) return pollMs;
    const oldest = Math.min(...payments.map((payment) => payment.createdAtSec));
    const history = await api.transactions(
      current.token,
      current.accountId,
      bankHistoryRange(oldest, nowSeconds()),
    );
    if (Result.isFailure(history)) {
      if (history.failure === "unauthorized") {
        report("unauthorized");
        return null;
      }
      report("unreachable");
      return backoffMs;
    }
    for (const payment of payments) {
      if (bankTransferPaying(payment, history.success) !== null) {
        await ledger.completePayment(payment, "bank");
      }
    }
    report("watching");
    return pollMs;
  };

  const poll = async () => {
    if (polling || stopped || watchers.size === 0) return;
    polling = true;
    let next: number | null = backoffMs;
    try {
      next = await lookOnce();
    } catch (error) {
      console.warn("[fazole] bank history not read", error);
      report("unreachable");
    } finally {
      polling = false;
    }
    if (next !== null) schedule(next);
  };

  return {
    connect: async (input) => {
      const token = parseMonetaTokenInput(input);
      if (token === null) return Result.fail("invalid-token");
      const iban = await shopIban();
      if (iban === null) return Result.fail("no-account");
      const accounts = await api.accounts(token);
      if (Result.isFailure(accounts)) {
        return Result.fail(
          accounts.failure === "unauthorized" ? "unauthorized" : "unreachable",
        );
      }
      const accountId = bankAccountIdFor(accounts.success, iban);
      if (accountId === null) return Result.fail("account-not-visible");
      const connected: MonetaConnection = { token, accountId, iban };
      await saveConnection(connected);
      return Result.succeed(connected);
    },
    disconnect: () => saveConnection(null),
    watch: (paymentId, onState) => {
      const listeners = watchers.get(paymentId) ?? new Set();
      listeners.add(onState);
      watchers.set(paymentId, listeners);
      if (timer === null) void poll();
      return () => {
        listeners.delete(onState);
        if (listeners.size === 0) watchers.delete(paymentId);
        if (watchers.size === 0 && timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      };
    },
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      watchers.clear();
    },
  };
};
