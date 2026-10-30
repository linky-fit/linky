import type { CzechIban } from "./czechAccount";
import type { CzkAmount } from "./money";
import type { VariableSymbol } from "./variableSymbol";

export interface SpdPayment {
  readonly iban: CzechIban;
  readonly amount: CzkAmount;
  readonly variableSymbol?: VariableSymbol | undefined;
  /** Shown by the payer's bank as the recipient's name, e.g. the shop's. */
  readonly recipientName?: string | undefined;
}

const RN_MAX_LENGTH = 35;

// SPD reserves `*` as the field separator and `%` for escapes; `+` is escaped
// like the ČBA reference implementation does.
const SPD_ESCAPES: Readonly<Record<string, string>> = {
  "*": "%2A",
  "+": "%2B",
  "%": "%25",
};

/** Diacritics are folded to ASCII because many banking apps mangle UTF-8. */
const toSpdText = (text: string, maxLength: number): string => {
  const ascii = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
  let result = "";
  for (const char of ascii) {
    const encoded = SPD_ESCAPES[char] ?? char;
    if (result.length + encoded.length > maxLength) break;
    result += encoded;
  }
  return result.trimEnd();
};

const formatSpdAmount = (amount: CzkAmount): string =>
  `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`;

/**
 * The Czech "QR platba" text: `SPD*1.0*ACC:<IBAN>*AM:<amount>*CC:CZK*RN:<name>*X-VS:<vs>*PT:IP`,
 * the fields in the order of the standard's own example. `PT:IP` asks the
 * payer's bank for an instant payment so the shop sees the money while the
 * customer waits.
 */
export const buildSpd = (payment: SpdPayment): string => {
  const recipientName = toSpdText(payment.recipientName ?? "", RN_MAX_LENGTH);
  return [
    "SPD",
    "1.0",
    `ACC:${payment.iban}`,
    `AM:${formatSpdAmount(payment.amount)}`,
    "CC:CZK",
    ...(recipientName ? [`RN:${recipientName}`] : []),
    ...(payment.variableSymbol ? [`X-VS:${payment.variableSymbol}`] : []),
    "PT:IP",
  ].join("*");
};
