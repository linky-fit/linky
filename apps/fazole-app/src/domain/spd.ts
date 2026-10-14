import type { CzechIban } from "./czechAccount";
import type { CzkAmount } from "./money";
import type { VariableSymbol } from "./variableSymbol";

export interface SpdPayment {
  readonly iban: CzechIban;
  readonly amount: CzkAmount;
  readonly variableSymbol?: VariableSymbol | undefined;
  readonly message?: string | undefined;
}

const MSG_MAX_LENGTH = 60;

// SPD reserves `*` as the field separator and `%` for escapes; `+` is escaped
// like the ČBA reference implementation does.
const SPD_ESCAPES: Readonly<Record<string, string>> = {
  "*": "%2A",
  "+": "%2B",
  "%": "%25",
};

/** Diacritics are folded to ASCII because many banking apps mangle UTF-8. */
const toSpdMessage = (text: string): string => {
  const ascii = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
  let result = "";
  for (const char of ascii) {
    const encoded = SPD_ESCAPES[char] ?? char;
    if (result.length + encoded.length > MSG_MAX_LENGTH) break;
    result += encoded;
  }
  return result.trimEnd();
};

const formatSpdAmount = (amount: CzkAmount): string =>
  `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`;

/** The Czech "QR platba" text: `SPD*1.0*ACC:<IBAN>*AM:<amount>*CC:CZK*X-VS:<vs>*MSG:<text>`. */
export const buildSpd = (payment: SpdPayment): string => {
  const message = toSpdMessage(payment.message ?? "");
  return [
    "SPD",
    "1.0",
    `ACC:${payment.iban}`,
    `AM:${formatSpdAmount(payment.amount)}`,
    "CC:CZK",
    ...(payment.variableSymbol ? [`X-VS:${payment.variableSymbol}`] : []),
    ...(message ? [`MSG:${message}`] : []),
  ].join("*");
};
