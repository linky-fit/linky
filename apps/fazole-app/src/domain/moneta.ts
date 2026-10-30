import { Option, Result, Schema } from "effect";
import { ibanToCzechAccount, type CzechIban } from "./czechAccount";
import { CzkAmount } from "./money";
import type { Payment } from "./records";
import { VariableSymbol } from "./variableSymbol";

/** MONETA Money Bank, whose business API tells the terminal when a bank QR payment arrived. */
export const MONETA_BANK_CODE = "0600";

export const isMonetaIban = (iban: CzechIban): boolean =>
  Result.match(ibanToCzechAccount(iban), {
    onSuccess: (account) => account.bankCode === MONETA_BANK_CODE,
    onFailure: () => false,
  });

/** An incoming transfer as the bank's transaction history lists it. */
export interface BankTransfer {
  /** The bank's `entryReference`; `null` when it sends none. */
  readonly id: string | null;
  readonly amountCzk: CzkAmount;
  /** The variable symbol the payer gave, without leading zeros; `null` without one. */
  readonly vs: VariableSymbol | null;
}

/** One page of the account's transaction history, as far as the terminal reads it. */
export interface BankHistoryPage {
  readonly pageCount: number;
  readonly transfers: readonly BankTransfer[];
}

/** An account as the bank lists it to a token. */
export interface BankAccount {
  readonly id: string;
  /** Compact and uppercase; `null` when the bank names the account another way. */
  readonly iban: string | null;
}

export interface BankHistoryRange {
  readonly fromDate: string;
  readonly toDate: string;
}

const optional = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(Schema.NullOr(schema));

// MONETA's history follows the Czech Open Banking Standard (ČOBS) v7; only what the matching reads is typed.
const ReferenceJson = Schema.Union([
  Schema.String,
  Schema.Array(Schema.String),
]);

const TransactionJson = Schema.Struct({
  entryReference: optional(Schema.String),
  amount: Schema.Struct({
    value: Schema.Union([Schema.Number, Schema.String]),
    currency: optional(Schema.String),
  }),
  creditDebitIndicator: Schema.String,
  reversalIndicator: optional(Schema.Boolean),
  status: optional(Schema.String),
  entryDetails: optional(
    Schema.Struct({
      transactionDetails: optional(
        Schema.Struct({
          references: optional(
            Schema.Struct({ endToEndIdentification: optional(Schema.String) }),
          ),
          remittanceInformation: optional(
            Schema.Struct({
              structured: optional(
                Schema.Struct({
                  creditorReferenceInformation: optional(
                    Schema.Struct({ reference: optional(ReferenceJson) }),
                  ),
                }),
              ),
            }),
          ),
        }),
      ),
    }),
  ),
});

const TransactionsPageJson = Schema.Struct({
  pageCount: optional(Schema.Number),
  transactions: optional(Schema.Array(Schema.Unknown)),
});

const AccountsJson = Schema.Struct({
  accounts: optional(Schema.Array(Schema.Unknown)),
});

const AccountJson = Schema.Struct({
  id: Schema.String,
  identification: optional(Schema.Struct({ iban: optional(Schema.String) })),
});

const decodePage = Schema.decodeUnknownOption(TransactionsPageJson);
const decodeTransaction = Schema.decodeUnknownOption(TransactionJson);
const decodeAccounts = Schema.decodeUnknownOption(AccountsJson);
const decodeAccount = Schema.decodeUnknownOption(AccountJson);
const isVariableSymbol = Schema.is(VariableSymbol);

// "VS:0001234", "VS 1234" or "VS:1234,KS:0308": the symbol's digits without the leading zeros the bank may keep.
const VS_PATTERN = /(?:^|[^A-Z0-9])VS:?\s*0*(\d{1,10})(?!\d)/iu;

const variableSymbolIn = (text: string): VariableSymbol | null => {
  const digits = VS_PATTERN.exec(text)?.[1];
  return digits !== undefined && isVariableSymbol(digits)
    ? VariableSymbol.make(digits)
    : null;
};

const halere = (value: number | string): number | null => {
  const amount =
    typeof value === "number"
      ? value
      : Number(value.replace(/\s/gu, "").replace(",", "."));
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
};

/** Posted and blocked items; a page holds nothing else, but a future status is not a transfer. */
const INCOMING_STATUSES = ["BOOK", "PDNG"];

/**
 * The incoming CZK transfers of one transaction history page; outgoing,
 * reversed and foreign-currency entries are skipped, and so is anything in
 * a shape the standard does not describe.
 */
export const readBankTransfers = (page: unknown): BankTransfer[] => {
  const transfers: BankTransfer[] = [];
  const decoded = Option.getOrNull(decodePage(page));
  for (const entry of decoded?.transactions ?? []) {
    const transaction = Option.getOrNull(decodeTransaction(entry));
    if (
      transaction === null ||
      transaction.creditDebitIndicator.toUpperCase() !== "CRDT" ||
      transaction.reversalIndicator === true
    ) {
      continue;
    }
    const status = transaction.status?.toUpperCase();
    if (status != null && !INCOMING_STATUSES.includes(status)) continue;
    const currency = transaction.amount.currency?.toUpperCase();
    if (currency != null && currency !== "CZK") continue;
    const amountCzk = halere(transaction.amount.value);
    if (amountCzk === null || amountCzk <= 0) continue;
    const details = transaction.entryDetails?.transactionDetails;
    const reference =
      details?.remittanceInformation?.structured?.creditorReferenceInformation
        ?.reference;
    const referenceText =
      typeof reference === "string" ? reference : (reference ?? []).join(",");
    transfers.push({
      id: transaction.entryReference ?? null,
      amountCzk: CzkAmount.make(amountCzk),
      vs:
        variableSymbolIn(referenceText) ??
        variableSymbolIn(details?.references?.endToEndIdentification ?? ""),
    });
  }
  return transfers;
};

/** A history page as the bank sent it: its transfers and how many pages there are, one when it does not say. */
export const readBankHistoryPage = (page: unknown): BankHistoryPage => ({
  pageCount: Math.max(1, Option.getOrNull(decodePage(page))?.pageCount ?? 1),
  transfers: readBankTransfers(page),
});

/** The transfer that pays the payment: the one carrying its variable symbol with at least its amount. */
export const bankTransferPaying = (
  payment: Pick<Payment, "vs" | "amountCzk">,
  transfers: readonly BankTransfer[],
): BankTransfer | null =>
  transfers.find(
    (transfer) =>
      transfer.vs === payment.vs && transfer.amountCzk >= payment.amountCzk,
  ) ?? null;

const compactIban = (iban: string) => iban.replace(/\s/gu, "").toUpperCase();

/** The accounts a token sees, as the bank's account list names them; entries in another shape are skipped. */
export const readBankAccounts = (body: unknown): BankAccount[] => {
  const accounts: BankAccount[] = [];
  for (const entry of Option.getOrNull(decodeAccounts(body))?.accounts ?? []) {
    const account = Option.getOrNull(decodeAccount(entry));
    if (account === null) continue;
    const iban = account.identification?.iban;
    accounts.push({
      id: account.id,
      iban: iban == null ? null : compactIban(iban),
    });
  }
  return accounts;
};

/** The bank's id of the account with `iban`; `null` when the token sees no such account. */
export const bankAccountIdFor = (
  accounts: readonly BankAccount[],
  iban: CzechIban,
): string | null =>
  accounts.find((account) => account.iban === compactIban(iban))?.id ?? null;

const DAY_SECONDS = 86_400;
const pad = (value: number) => String(value).padStart(2, "0");

/** A Unix time as the standard's ISO date-time, in this device's time zone, e.g. `2026-10-30T09:15:00+01:00`. */
const isoDateTime = (sec: number): string => {
  const date = new Date(sec * 1000);
  const offsetMinutes = -date.getTimezoneOffset();
  const offset = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${offsetMinutes < 0 ? "-" : "+"}${pad(Math.floor(offset / 60))}:${pad(offset % 60)}`
  );
};

const startOfDay = (sec: number): number => {
  const date = new Date(sec * 1000);
  date.setHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
};

/**
 * The history window that holds the transfer for a payment created at
 * `createdAtSec`: from the day before, as the bank's booking date may
 * precede the device's clock, up to now.
 */
export const bankHistoryRange = (
  createdAtSec: number,
  nowSec: number,
): BankHistoryRange => ({
  fromDate: isoDateTime(startOfDay(createdAtSec) - DAY_SECONDS),
  toDate: isoDateTime(nowSec),
});
