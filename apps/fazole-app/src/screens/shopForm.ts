import { Result, Schema } from "effect";
import { useState } from "react";
import { copy } from "../copy";
import {
  czechAccountToIban,
  czechBankName,
  formatCzechIban,
  ibanToCzechAccount,
  parseCzechAccount,
  type CzechAccountErrorReason,
  type CzechIban,
  type ShopProfile,
} from "../domain";
import { ShopName } from "../storage/shop";

const accountErrors: Record<CzechAccountErrorReason, string> = {
  invalidFormat: copy.shopFields.accountInvalidFormat,
  invalidChecksum: copy.shopFields.accountInvalidChecksum,
  unknownBank: copy.shopFields.accountUnknownBank,
};

export type AccountCheck =
  | { readonly kind: "empty" }
  | {
      readonly kind: "valid";
      readonly iban: CzechIban;
      /** "Česká spořitelna, a.s. · CZ65 0800 0000 1920 0014 5399" */
      readonly description: string;
    }
  | { readonly kind: "invalid"; readonly error: string };

/** Groups an IBAN by four characters, the way banks print it. */
export const formatIban = (iban: string): string =>
  iban.replace(/(.{4})(?=.)/gu, "$1 ");

/** Checks the optional bank account as typed, `[prefix-]number/bank code` or a Czech IBAN: empty, valid with its bank and IBAN, or why not. */
export const checkAccount = (input: string): AccountCheck => {
  if (input.trim() === "") return { kind: "empty" };
  const parsed = /^\s*cz/iu.test(input)
    ? ibanToCzechAccount(input)
    : parseCzechAccount(input);
  if (Result.isFailure(parsed)) {
    return { kind: "invalid", error: accountErrors[parsed.failure.reason] };
  }
  const iban = czechAccountToIban(parsed.success);
  return {
    kind: "valid",
    iban,
    description: copy.shopFields.accountValid(
      czechBankName(parsed.success.bankCode) ?? parsed.success.bankCode,
      formatIban(iban),
    ),
  };
};

/** Typing a four-digit bank code finishes the account, so its error can show before the field loses focus. */
export const looksComplete = (input: string): boolean =>
  /\/\s*\d{4}\s*$/u.test(input);

const isShopName = Schema.is(ShopName);

/** The optional shop name and bank account with live validation; `initial` prefills an edit. */
export const useShopForm = (initial?: ShopProfile | null) => {
  const [name, setName] = useState(initial?.name ?? "");
  const [account, setAccount] = useState(
    initial?.iban ? formatCzechIban(initial.iban) : "",
  );
  const [accountTouched, setAccountTouched] = useState(account !== "");
  const [submitted, setSubmitted] = useState(false);
  const accountCheck = checkAccount(account);
  const showAccountError =
    submitted || accountTouched || looksComplete(account);
  const trimmedName = name.trim();
  const nameValid = trimmedName === "" || isShopName(trimmedName);
  return {
    name,
    setName,
    account,
    setAccount,
    touchAccount: () => setAccountTouched(true),
    accountCheck,
    /** Nothing filled in yet: the shop can be set up later. */
    empty: trimmedName === "" && account.trim() === "",
    nameError:
      submitted && !nameValid ? copy.shopFields.nameTooLong : undefined,
    accountError:
      accountCheck.kind === "invalid" && showAccountError
        ? accountCheck.error
        : undefined,
    /** The profile to save, or `null` after revealing what is wrong. */
    submit: (): ShopProfile | null => {
      setSubmitted(true);
      if (!nameValid || accountCheck.kind === "invalid") return null;
      return {
        name: trimmedName === "" ? null : trimmedName,
        iban: accountCheck.kind === "valid" ? accountCheck.iban : null,
        picture: initial?.picture ?? null,
      };
    },
  };
};

export type ShopForm = ReturnType<typeof useShopForm>;
