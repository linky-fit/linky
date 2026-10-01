# Bank QR

`parseBankPayment(text)` recognizes the three supported bank QR formats and returns one shape:

```ts
import {
  parseBankPayment,
  tryParseBankPayment,
} from "@linky-fit/proxy-payment";

const payment = parseBankPayment(
  "SPD*1.0*ACC:CZ6508000000192000145399+GIBACZPX*AM:250*CC:CZK",
);
payment.format; // "spd" | "epc" | "bysquare"
payment.fields; // { ACC: "CZ65…", BIC: "GIBACZPX", AM: "250", CC: "CZK" }
payment.payload; // the trimmed input

tryParseBankPayment("hello"); // null
```

| Format     | Recognized by                            | Notes                                                                    |
| ---------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| `spd`      | `SPD*` prefix                            | `ACC:IBAN+BIC` is split into `ACC` and `BIC`; values are percent-decoded |
| `epc`      | `BCD` first line                         | SEPA credit transfer, EUR only; the account must be IBAN-shaped          |
| `bysquare` | base32hex payload, 16 to 4096 characters | decoded with the patched `bysquare/pay`; only `PaymentOrder` qualifies   |

Every parser throws an `Error` whose message is a stable code (`spd-missing-account`, `bank-payment-invalid-epc`, `bank-payment-unsupported`, …) for the consumer to translate. `isBankPaymentPayload(text)` is the cheap classifier for scanned or pasted text; `getBankPaymentOfferCurrency(text)` returns `"CZK"`, `"EUR"` or `null`.

## Editing

`getBankPaymentEditableFieldKeys(format)` lists the fields a user may change in display order (the amount is edited separately, the currency never). `updateBankPaymentFields(payment, edits)` normalizes each edit, then re-encodes the payment in its original format and re-parses it. Accounts go through `normalizeBankAccountInput` (IBAN mod-97, or a CZ/SK `prefix-number/bank` account with mod-11 checks, the country taken from the scanned IBAN), amounts must match `^\d+(\.\d{1,2})?$` after dropping whitespace and turning a comma into a dot, BICs are checked by pattern. An SPD `CRC32` is dropped because it authenticated the original string. Failures throw `bank-payment-invalid-account`, `bank-payment-invalid-amount` or `bank-payment-invalid-bic`.

`formatDomesticBankAccount(iban)` renders CZ/SK IBANs the way their banks display them (`19-2000145399/0800`) and returns `null` for any other country.

## Decoding bounds

PAY by square decoding is bounded in the patched dependency (the repo-root `patches/bysquare@4.0.0.patch`): at most 4096 encoded characters, a positive declared decompressed size, exact output-size matching, and payment and account loops bounded by the fields present. Parsing runs on untrusted chat text and in the service worker, so these bounds are load-bearing.
