import { CzkAmount } from "./money";

/** The keys of `@linky-fit/ui`'s `Keypad` with `decimal`: digits, the decimal key and backspace. */
export type KeypadKey =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "."
  | "⌫"
  | "C";

/** What the merchant typed with a decimal comma, e.g. `"12,5"`; empty while nothing is typed. */
export type KeypadInput = string;

/** The most one payment can ask for: 1 000 000 Kč. */
export const MAX_AMOUNT = CzkAmount.make(100_000_000);

const DECIMAL_COMMA = ",";

export const keypadAmount = (input: KeypadInput): CzkAmount => {
  const [whole = "", fraction = ""] = input.split(DECIMAL_COMMA);
  return CzkAmount.make(
    Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0")),
  );
};

/** Applies a key to what was typed: up to two haléře digits, never past `maxAmount`. */
export const pressKeypadKey = (
  input: KeypadInput,
  key: KeypadKey,
  maxAmount: CzkAmount = MAX_AMOUNT,
): KeypadInput => {
  if (key === "C") return "";
  if (key === "⌫") return input.slice(0, -1);
  if (key === ".") {
    return input.includes(DECIMAL_COMMA)
      ? input
      : `${input || "0"}${DECIMAL_COMMA}`;
  }
  const fraction = input.split(DECIMAL_COMMA)[1];
  if (fraction !== undefined && fraction.length >= 2) return input;
  const next = input === "0" ? key : `${input}${key}`;
  return keypadAmount(next) <= maxAmount ? next : input;
};

export const canRequestPayment = (input: KeypadInput): boolean =>
  keypadAmount(input) > 0;

export interface NumberSeparators {
  readonly group: string;
  readonly decimal: string;
}

/** Shows the typed amount as typed, a trailing decimal mark included, with the locale's separators. */
export const formatKeypadInput = (
  input: KeypadInput,
  separators: NumberSeparators,
): string => {
  const [whole = "", fraction] = input.split(DECIMAL_COMMA);
  const grouped = (whole || "0").replace(
    /\B(?=(\d{3})+(?!\d))/gu,
    separators.group,
  );
  return fraction === undefined
    ? grouped
    : `${grouped}${separators.decimal}${fraction}`;
};
