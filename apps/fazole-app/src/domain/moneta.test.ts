import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { czechAccountToIban, parseCzechAccount } from "./czechAccount";
import {
  bankAccountIdFor,
  bankHistoryRange,
  bankTransferPaying,
  isMonetaIban,
  readBankAccounts,
  readBankHistoryPage,
  readBankTransfers,
} from "./moneta";
import { CzkAmount } from "./money";
import { VariableSymbol } from "./variableSymbol";

const ibanOf = (account: string) => {
  const parsed = parseCzechAccount(account);
  if (Result.isFailure(parsed)) throw new Error(`invalid ${account}`);
  return czechAccountToIban(parsed.success);
};

/** A ČOBS v7 transaction as the bank lists an incoming domestic payment. */
const incoming = (overrides: Record<string, unknown> = {}) => ({
  entryReference: "E-1",
  amount: { value: 750.5, currency: "CZK" },
  creditDebitIndicator: "CRDT",
  reversalIndicator: false,
  status: "BOOK",
  bookingDate: { date: "2026-10-30" },
  entryDetails: {
    transactionDetails: {
      references: { endToEndIdentification: "12345" },
      relatedParties: { debtor: { name: "Jan Novák" } },
      remittanceInformation: {
        unstructured: "kava",
        structured: {
          creditorReferenceInformation: {
            reference: "VS:0001234567,KS:0308,SS:7",
          },
        },
      },
    },
  },
  ...overrides,
});

describe("isMonetaIban", () => {
  it("is true for a MONETA account only", () => {
    expect(isMonetaIban(ibanOf("2000145399/0600"))).toBe(true);
    expect(isMonetaIban(ibanOf("2000145399/0800"))).toBe(false);
  });
});

describe("readBankTransfers", () => {
  it("reads incoming CZK transfers with their symbol in haléře", () => {
    expect(readBankTransfers({ transactions: [incoming()] })).toEqual([
      { id: "E-1", amountCzk: 75_050, vs: "1234567" },
    ]);
  });

  it("takes the symbol from a list reference, a string amount or the end-to-end id", () => {
    expect(
      readBankTransfers({
        transactions: [
          incoming({
            amount: { value: "1 000,00", currency: "CZK" },
            entryDetails: {
              transactionDetails: {
                remittanceInformation: {
                  structured: {
                    creditorReferenceInformation: {
                      reference: ["KS:0308", "VS:42"],
                    },
                  },
                },
              },
            },
          }),
          incoming({
            entryReference: null,
            entryDetails: {
              transactionDetails: {
                references: { endToEndIdentification: "VS:0009" },
              },
            },
          }),
          incoming({ entryDetails: null }),
        ],
      }),
    ).toEqual([
      { id: "E-1", amountCzk: 100_000, vs: "42" },
      { id: null, amountCzk: 75_050, vs: "9" },
      { id: "E-1", amountCzk: 75_050, vs: null },
    ]);
  });

  it("skips outgoing, reversed, foreign-currency, future and malformed entries", () => {
    expect(
      readBankTransfers({
        transactions: [
          incoming({ creditDebitIndicator: "DBIT" }),
          incoming({ reversalIndicator: true }),
          incoming({ amount: { value: 10, currency: "EUR" } }),
          incoming({ status: "FUTR" }),
          incoming({ amount: { value: "n/a" } }),
          incoming({ amount: { value: 0 } }),
          { creditDebitIndicator: "CRDT" },
          "not an entry",
        ],
      }),
    ).toEqual([]);
    expect(readBankTransfers(null)).toEqual([]);
    expect(readBankTransfers({ transactions: null })).toEqual([]);
  });
});

describe("readBankHistoryPage", () => {
  it("carries the page count, at least one, with the page's transfers", () => {
    expect(
      readBankHistoryPage({ pageCount: 3, transactions: [incoming()] }),
    ).toEqual({
      pageCount: 3,
      transfers: [{ id: "E-1", amountCzk: 75_050, vs: "1234567" }],
    });
    expect(readBankHistoryPage({ pageCount: 0 })).toEqual({
      pageCount: 1,
      transfers: [],
    });
    expect(readBankHistoryPage("x")).toEqual({ pageCount: 1, transfers: [] });
  });
});

describe("bankTransferPaying", () => {
  const payment = {
    vs: VariableSymbol.make("1234567"),
    amountCzk: CzkAmount.make(75_050),
  };

  it("is the transfer with the payment's symbol and at least its amount", () => {
    const transfers = readBankTransfers({
      transactions: [
        incoming({ entryReference: "short", amount: { value: 750 } }),
        incoming({ entryReference: "exact" }),
        incoming({ entryReference: "more", amount: { value: 1000 } }),
      ],
    });
    expect(bankTransferPaying(payment, transfers)?.id).toBe("exact");
    expect(
      bankTransferPaying(
        { ...payment, vs: VariableSymbol.make("5") },
        transfers,
      ),
    ).toBeNull();
    expect(bankTransferPaying(payment, [])).toBeNull();
  });
});

describe("the account list", () => {
  const iban = ibanOf("2000145399/0600");
  const spaced = iban.replace(/(.{4})/gu, "$1 ").toLowerCase();

  it("finds the account by IBAN, however the bank spaces it", () => {
    const accounts = readBankAccounts({
      accounts: [
        { id: "eur", identification: { iban: "CZ00" }, currency: "EUR" },
        { id: "main", identification: { iban: spaced } },
        { id: "other", identification: {} },
        { identification: { iban } },
        "not an account",
      ],
    });
    expect(accounts).toEqual([
      { id: "eur", iban: "CZ00" },
      { id: "main", iban },
      { id: "other", iban: null },
    ]);
    expect(bankAccountIdFor(accounts, iban)).toBe("main");
    expect(bankAccountIdFor(accounts.slice(0, 1), iban)).toBeNull();
    expect(readBankAccounts({})).toEqual([]);
    expect(readBankAccounts(null)).toEqual([]);
  });
});

describe("bankHistoryRange", () => {
  it("starts the day before the payment and ends now, in the standard's date-time form", () => {
    const createdAt = Date.UTC(2026, 9, 30, 10, 0, 0) / 1000;
    const now = createdAt + 90;
    const range = bankHistoryRange(createdAt, now);
    const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/u;
    expect(range.fromDate).toMatch(isoDateTime);
    expect(range.toDate).toMatch(isoDateTime);
    expect(range.fromDate < range.toDate).toBe(true);
    const dayBefore = new Date((createdAt - 86_400) * 1000);
    expect(range.fromDate.slice(0, 10)).toBe(
      `${dayBefore.getFullYear()}-${String(dayBefore.getMonth() + 1).padStart(2, "0")}-${String(dayBefore.getDate()).padStart(2, "0")}`,
    );
    expect(range.fromDate.slice(11, 19)).toBe("00:00:00");
  });
});
