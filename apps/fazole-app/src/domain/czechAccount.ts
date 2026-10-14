import { Data, Result, Schema } from "effect";
import { CZECH_BANKS } from "./czechBanks";

export type CzechAccountErrorReason =
  | "invalidFormat"
  | "invalidChecksum"
  | "unknownBank";

export class CzechAccountError extends Data.TaggedError("CzechAccountError")<{
  readonly reason: CzechAccountErrorReason;
}> {}

/** Digits zero-padded to their full width, as they appear inside an IBAN. */
export interface CzechAccount {
  readonly prefix: string;
  readonly number: string;
  readonly bankCode: string;
}

type AccountResult = Result.Result<CzechAccount, CzechAccountError>;

const ACCOUNT_PATTERN = /^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/;
const IBAN_PATTERN = /^CZ(\d{2})(\d{4})(\d{6})(\d{10})$/;
const MOD11_WEIGHTS = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1];
const CZ_LETTERS_AS_DIGITS = "1235";

const fail = (reason: CzechAccountErrorReason): AccountResult =>
  Result.fail(new CzechAccountError({ reason }));

const removeWhitespace = (value: string): string => value.replace(/\s/g, "");

const passesMod11 = (digits: string): boolean => {
  const padded = digits.padStart(MOD11_WEIGHTS.length, "0");
  const sum = MOD11_WEIGHTS.reduce(
    (total, weight, index) => total + weight * Number(padded[index]),
    0,
  );
  return sum % 11 === 0;
};

const mod97 = (digits: string): number =>
  [...digits].reduce((rest, digit) => (rest * 10 + Number(digit)) % 97, 0);

const countNonZeroDigits = (digits: string): number =>
  digits.replace(/0/g, "").length;

const validateAccount = (account: CzechAccount): AccountResult => {
  if (countNonZeroDigits(account.number) < 2) return fail("invalidFormat");
  if (!passesMod11(account.prefix) || !passesMod11(account.number)) {
    return fail("invalidChecksum");
  }
  if (!Object.hasOwn(CZECH_BANKS, account.bankCode)) {
    return fail("unknownBank");
  }
  return Result.succeed(account);
};

/** Parses `[prefix-]number/bankCode`, ignoring whitespace. */
export const parseCzechAccount = (input: string): AccountResult => {
  const match = ACCOUNT_PATTERN.exec(removeWhitespace(input));
  if (!match) return fail("invalidFormat");
  const [, prefix = "", number = "", bankCode = ""] = match;
  return validateAccount({
    prefix: prefix.padStart(6, "0"),
    number: number.padStart(10, "0"),
    bankCode,
  });
};

export const ibanToCzechAccount = (iban: string): AccountResult => {
  const compact = removeWhitespace(iban).toUpperCase();
  const match = IBAN_PATTERN.exec(compact);
  if (!match) return fail("invalidFormat");
  const [, checkDigits = "", bankCode = "", prefix = "", number = ""] = match;
  const bban = `${bankCode}${prefix}${number}`;
  if (mod97(`${bban}${CZ_LETTERS_AS_DIGITS}${checkDigits}`) !== 1) {
    return fail("invalidChecksum");
  }
  return validateAccount({ prefix, number, bankCode });
};

/** A valid Czech IBAN in compact uppercase form. */
export const CzechIban = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(IBAN_PATTERN),
    Schema.makeFilter(
      (iban: string) => Result.isSuccess(ibanToCzechAccount(iban)),
      { description: "a valid Czech IBAN" },
    ),
  ),
  Schema.brand("CzechIban"),
);
export type CzechIban = typeof CzechIban.Type;

export const czechAccountToIban = (account: CzechAccount): CzechIban => {
  const bban = `${account.bankCode}${account.prefix}${account.number}`;
  const checkDigits = 98 - mod97(`${bban}${CZ_LETTERS_AS_DIGITS}00`);
  return CzechIban.make(`CZ${String(checkDigits).padStart(2, "0")}${bban}`);
};

const stripLeadingZeros = (digits: string): string => digits.replace(/^0+/, "");

/** Formats as `prefix-number/bankCode` without leading zeros, e.g. `19-2000145399/0800`. */
export const formatCzechAccount = (account: CzechAccount): string => {
  const prefix = stripLeadingZeros(account.prefix);
  const number = `${stripLeadingZeros(account.number)}/${account.bankCode}`;
  return prefix ? `${prefix}-${number}` : number;
};

/** The account an IBAN stored by this app names, formatted for display. */
export const formatCzechIban = (iban: CzechIban): string =>
  Result.match(ibanToCzechAccount(iban), {
    onSuccess: formatCzechAccount,
    onFailure: () => iban,
  });

/** The bank's name for a bank code, e.g. `Česká spořitelna, a.s.` for `0800`. */
export const czechBankName = (bankCode: string): string | null =>
  CZECH_BANKS[bankCode] ?? null;
