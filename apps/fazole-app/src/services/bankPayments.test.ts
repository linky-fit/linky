import { Result } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  czechAccountToIban,
  CzkAmount,
  parseCzechAccount,
  VariableSymbol,
  type BankAccount,
  type BankTransfer,
  type CzechIban,
} from "../domain";
import type { MonetaConnection } from "../storage/monetaSetting";
import {
  createBankPayments,
  type BankPayments,
  type BankWatchState,
} from "./bankPayments";
import type { MonetaApi, MonetaFailure } from "./monetaApi";
import { setup } from "./testing/fakes";

const ibanOf = (account: string): CzechIban => {
  const parsed = parseCzechAccount(account);
  if (Result.isFailure(parsed)) throw new Error(`invalid ${account}`);
  return czechAccountToIban(parsed.success);
};
const iban = ibanOf("2000145399/0600");
const token = "token-".padEnd(32, "0");
const shopAccount: BankAccount = { id: "acc-1", iban };

const transfer = (vs: string, czk: number): BankTransfer => ({
  id: `E-${vs}-${czk}`,
  amountCzk: CzkAmount.make(czk * 100),
  vs: VariableSymbol.make(vs),
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const running: BankPayments[] = [];
afterEach(() => {
  for (const payments of running.splice(0)) payments.stop();
});

/** Bank payments over a scripted bank: `history` answers the n-th transactions call, `accounts` the accounts call. */
const bankPaymentsOver = ({
  accounts = Result.succeed([shopAccount]),
  history = () => Result.succeed([]),
  connected = true,
}: {
  readonly accounts?: Result.Result<readonly BankAccount[], MonetaFailure>;
  readonly history?: (
    call: number,
  ) => Result.Result<readonly BankTransfer[], MonetaFailure>;
  readonly connected?: boolean;
} = {}) => {
  const { ledger } = setup();
  let stored: MonetaConnection | null = connected
    ? { token, accountId: "acc-1", iban }
    : null;
  const calls: { readonly accountId: string; readonly fromDate: string }[] = [];
  const api: MonetaApi = {
    accounts: async () => accounts,
    transactions: async (_token, accountId, range) => {
      calls.push({ accountId, fromDate: range.fromDate });
      return history(calls.length);
    },
  };
  const bankPayments = createBankPayments({
    ledger,
    api,
    connection: async () => stored,
    saveConnection: async (connection) => {
      stored = connection;
    },
    shopIban: async () => iban,
    pollMs: 10,
    backoffMs: 30,
  });
  running.push(bankPayments);
  return { ledger, bankPayments, calls, connection: () => stored };
};

describe("connecting a token", () => {
  it("stores the token with the shop's account once the bank lists it", async () => {
    const { bankPayments, connection } = bankPaymentsOver({ connected: false });
    expect(await bankPayments.connect(`  ${token}\n`)).toEqual(
      Result.succeed({ token, accountId: "acc-1", iban }),
    );
    expect(connection()).toEqual({ token, accountId: "acc-1", iban });
    await bankPayments.disconnect();
    expect(connection()).toBeNull();
  });

  it("refuses a token that is none, that the bank refuses, or that sees another account", async () => {
    expect(
      await bankPaymentsOver({ connected: false }).bankPayments.connect("x y"),
    ).toEqual(Result.fail("invalid-token"));
    expect(
      await bankPaymentsOver({
        connected: false,
        accounts: Result.fail("unauthorized"),
      }).bankPayments.connect(token),
    ).toEqual(Result.fail("unauthorized"));
    expect(
      await bankPaymentsOver({
        connected: false,
        accounts: Result.fail("rejected"),
      }).bankPayments.connect(token),
    ).toEqual(Result.fail("unreachable"));
    const elsewhere = bankPaymentsOver({
      connected: false,
      accounts: Result.succeed([
        { id: "x", iban: ibanOf("19-2000145399/0600") },
      ]),
    });
    expect(await elsewhere.bankPayments.connect(token)).toEqual(
      Result.fail("account-not-visible"),
    );
    expect(elsewhere.connection()).toBeNull();
  });
});

describe("watching a payment", () => {
  it("marks the payment paid by bank once a transfer with its symbol and amount shows up", async () => {
    let vs = "1";
    const { ledger, bankPayments, calls } = bankPaymentsOver({
      // Nothing, then a smaller transfer with the symbol, then the full one next to it.
      history: (call) =>
        Result.succeed(
          call === 1
            ? []
            : call === 2
              ? [transfer(vs, 99), transfer("777", 100)]
              : [transfer(vs, 99), transfer(vs, 100)],
        ),
    });
    const payment = await ledger.createPayment(CzkAmount.make(10_000));
    vs = payment.vs;
    const states: BankWatchState[] = [];
    const unwatch = bankPayments.watch(payment.id, (state) =>
      states.push(state),
    );
    await expect
      .poll(async () => (await ledger.payment(payment.id))?.status)
      .toBe("paid");
    unwatch();
    expect(await ledger.payment(payment.id)).toMatchObject({
      status: "paid",
      method: "bank",
    });
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls[0]?.accountId).toBe("acc-1");
    expect(new Set(states)).toEqual(new Set(["watching"]));
  });

  it("reports an unreachable bank and keeps looking, and stops when the bank refuses the token", async () => {
    const unreachable = bankPaymentsOver({
      history: () => Result.fail("unreachable"),
    });
    const payment = await unreachable.ledger.createPayment(CzkAmount.make(100));
    const states: BankWatchState[] = [];
    const unwatch = unreachable.bankPayments.watch(payment.id, (state) =>
      states.push(state),
    );
    await expect.poll(() => unreachable.calls.length).toBeGreaterThanOrEqual(2);
    expect(states[0]).toBe("unreachable");
    unwatch();
    const before = unreachable.calls.length;
    await sleep(80);
    expect(unreachable.calls.length).toBe(before);

    const refused = bankPaymentsOver({
      history: () => Result.fail("unauthorized"),
    });
    const other = await refused.ledger.createPayment(CzkAmount.make(100));
    const refusedStates: BankWatchState[] = [];
    refused.bankPayments.watch(other.id, (state) => refusedStates.push(state));
    await expect.poll(() => refusedStates.length).toBe(1);
    await sleep(80);
    expect(refusedStates).toEqual(["unauthorized"]);
    expect(refused.calls.length).toBe(1);
  });

  it("asks the bank once for every watched payment, from the oldest one's day", async () => {
    const { ledger, bankPayments, calls } = bankPaymentsOver();
    const first = await ledger.createPayment(CzkAmount.make(100));
    const second = await ledger.createPayment(CzkAmount.make(200));
    const stopFirst = bankPayments.watch(first.id, () => {});
    const stopSecond = bankPayments.watch(second.id, () => {});
    await expect.poll(() => calls.length).toBeGreaterThanOrEqual(2);
    stopFirst();
    stopSecond();
    expect(new Set(calls.map((call) => call.fromDate)).size).toBe(1);
  });
});
