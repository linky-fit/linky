const IBAN_PATTERN = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
const BIC_PATTERN = /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;

export type DomesticBankAccountCountry = "CZ" | "SK";

const isDomesticCountry = (
  value: string,
): value is DomesticBankAccountCountry => value === "CZ" || value === "SK";

const stripSpaces = (value: string): string => value.replace(/\s/g, "");

export const normalizeIban = (value: string): string =>
  stripSpaces(value).toUpperCase();

// ISO 7064 mod 97-10 over the IBAN with its first four characters moved to the
// end and letters expanded to two digits (A=10 … Z=35).
const ibanRemainder = (iban: string): number => {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder;
};

export const isValidIban = (value: string): boolean => {
  const iban = normalizeIban(value);
  return IBAN_PATTERN.test(iban) && ibanRemainder(iban) === 1;
};

export const isValidBic = (value: string): boolean =>
  BIC_PATTERN.test(stripSpaces(value).toUpperCase());

// Czech and Slovak account numbers share the mod-11 check inherited from the
// Czechoslovak banking system: digits weighted right-to-left by successive
// powers of two modulo 11.
const MOD11_WEIGHTS = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1];

const passesMod11 = (digits: string): boolean => {
  const padded = digits.padStart(MOD11_WEIGHTS.length, "0");
  let sum = 0;
  for (let index = 0; index < padded.length; index += 1) {
    sum += Number(padded[index]) * (MOD11_WEIGHTS[index] ?? 0);
  }
  return sum % 11 === 0;
};

// Czech and Slovak IBANs share one layout: country, two check digits, a
// four-digit bank code, a six-digit account prefix and a ten-digit account
// number.
const DOMESTIC_IBAN_LENGTH = 24;

export const getDomesticBankAccountCountry = (
  iban: string,
): DomesticBankAccountCountry | null => {
  const country = normalizeIban(iban).slice(0, 2);
  return isDomesticCountry(country) ? country : null;
};

// `prefix-number/bankCode` (prefix omitted when zero) for CZ/SK IBANs, null for
// any other IBAN.
export const formatDomesticBankAccount = (iban: string): string | null => {
  const normalized = normalizeIban(iban);
  if (
    getDomesticBankAccountCountry(normalized) === null ||
    normalized.length !== DOMESTIC_IBAN_LENGTH ||
    !/^\d+$/.test(normalized.slice(2))
  ) {
    return null;
  }

  const bankCode = normalized.slice(4, 8);
  const prefix = normalized.slice(8, 14).replace(/^0+/, "");
  const number = normalized.slice(14).replace(/^0+/, "");
  return `${prefix ? `${prefix}-` : ""}${number}/${bankCode}`;
};

const DOMESTIC_ACCOUNT_PATTERN = /^(?:(\d{1,6})-)?(\d{1,10})\/(\d{4})$/;

export const parseDomesticBankAccount = (
  value: string,
  country: DomesticBankAccountCountry,
): string | null => {
  const match = DOMESTIC_ACCOUNT_PATTERN.exec(stripSpaces(value));
  if (!match) return null;

  const prefix = match[1] ?? "";
  const number = match[2] ?? "";
  const bankCode = match[3] ?? "";
  if (!passesMod11(prefix) || !passesMod11(number)) return null;

  const bban = `${bankCode}${prefix.padStart(6, "0")}${number.padStart(10, "0")}`;
  const checkDigits = 98 - ibanRemainder(`${country}00${bban}`);
  return `${country}${String(checkDigits).padStart(2, "0")}${bban}`;
};

// Accepts an IBAN or a Czech/Slovak domestic account and returns the IBAN, or
// null when the input is not a valid account.
export const normalizeBankAccountInput = (
  value: string,
  domesticCountry: DomesticBankAccountCountry,
): string | null => {
  const compact = stripSpaces(value);
  if (compact.includes("/")) {
    return parseDomesticBankAccount(compact, domesticCountry);
  }
  const iban = compact.toUpperCase();
  return isValidIban(iban) ? iban : null;
};
