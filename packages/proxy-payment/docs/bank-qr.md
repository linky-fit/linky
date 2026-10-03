# Bank QR

`parseBankPayment(text)` recognizes the five supported bank QR formats and returns one shape:

```ts
import {
  parseBankPayment,
  tryParseBankPayment,
} from "@linky-fit/proxy-payment";

const payment = parseBankPayment(
  "SPD*1.0*ACC:CZ6508000000192000145399+GIBACZPX*AM:250*CC:CZK",
);
payment.format; // "spd" | "epc" | "bysquare" | "payme" | "pix"
payment.fields; // { ACC: "CZ65…", BIC: "GIBACZPX", AM: "250", CC: "CZK" }
payment.payload; // the trimmed input

tryParseBankPayment("hello"); // null
```

| Format     | Recognized by                                              | Notes                                                                                            |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `spd`      | `SPD*` prefix                                              | `ACC:IBAN+BIC` is split into `ACC` and `BIC`; values are percent-decoded                         |
| `epc`      | `BCD` first line                                           | SEPA credit transfer, EUR only; the account must be IBAN-shaped                                  |
| `bysquare` | base32hex payload, 16 to 4096 characters                   | decoded with the patched `bysquare/pay`; only `PaymentOrder` qualifies                           |
| `payme`    | `https://payme.sk` link, `?V=1` or `/2/{m,e,q,p}/PME` path | Slovak payment link; `IBAN`/`CN`/`PI` become `ACC`/`RN`/reference, a missing `CC` means `EUR`    |
| `pix`      | `000201` prefix and the `br.gov.bcb.pix` GUI               | Brazilian EMV "BR Code"; the CRC-16 must match, the currency (986) and country (BR) when present |

A payme `PI` of the form `/VS…/SS…/KS…` is split into `X-VS`, `X-SS` and `X-KS`; any other `PI` is kept as `RF`. The amount, when present, must match `^\d+(\.\d{1,2})?$`.

A Pix `ACC` is the Pix key of a static code or the payload URL of a dynamic one (the bank app resolves it); `RN` is the merchant name, `CITY` the merchant city, `MSG` the description and `RF` the txid, omitted when it is the `***` placeholder. `CC` is always `BRL`.

Every parser throws an `Error` whose message is a stable code (`spd-missing-account`, `bank-payment-invalid-epc`, `bank-payment-invalid-pix-crc`, `bank-payment-unsupported`, …) for the consumer to translate. `isBankPaymentPayload(text)` is the cheap classifier for scanned or pasted text; `getBankPaymentOfferCurrency(text)` returns one of `BANK_PAYMENT_OFFER_CURRENCIES` (`"CZK"`, `"EUR"`, `"BRL"`) or `null`.

## Editing

`getBankPaymentEditableFieldKeys(format)` lists the fields a user may change in display order (the amount is edited separately, the currency never). `createBlankBankPayment(currency)` is the starting point of a manual entry: a payment with only `CC` set, SPD for `CZK` and `EUR`, Pix for `BRL`, which does not parse until `updateBankPaymentFields` has filled in what its format requires. `updateBankPaymentFields(payment, edits)` normalizes each edit, then re-encodes the payment in its original format and re-parses it. Accounts go through `normalizeBankAccountInput` (IBAN mod-97, or a CZ/SK `prefix-number/bank` account with mod-11 checks, the country taken from the scanned IBAN), amounts must match `^\d+(\.\d{1,2})?$` after dropping whitespace and turning a comma into a dot, BICs are checked by pattern. An SPD `CRC32` is dropped because it authenticated the original string. A payme link is re-encoded with spaces as `+`, keeps its version and type path, and rebuilds `PI` from the symbols when any is set, otherwise from `RF`; setting both throws `bank-payment-invalid-reference`. Failures throw `bank-payment-invalid-account`, `bank-payment-invalid-amount`, `bank-payment-invalid-bic` or `bank-payment-invalid-reference`.

A Pix code is rebuilt tag by tag with fresh lengths and CRC: the key or URL goes back into the subtag it came from, the amount is written with two decimals, a cleared `RF` becomes `***`. Pix text is ASCII, so accents are stripped (`João` becomes `Joao`) and anything else non-ASCII throws; `ACC` is a key of up to 77 characters without whitespace (`bank-payment-invalid-account`), `RN` is required and at most 25 characters (`bank-payment-invalid-recipient`), `CITY` is required and at most 15 characters (`bank-payment-invalid-city`), `RF` is alphanumeric and at most 25 characters (`bank-payment-invalid-reference`), `MSG` throws `bank-payment-invalid-message` on bad characters and `bank-payment-invalid-pix` when the merchant account tag would exceed 99 characters.

`formatDomesticBankAccount(iban)` renders CZ/SK IBANs the way their banks display them (`19-2000145399/0800`) and returns `null` for any other country.

## Decoding bounds

PAY by square decoding is bounded in the patched dependency (the repo-root `patches/bysquare@4.0.0.patch`): at most 4096 encoded characters, a positive declared decompressed size, exact output-size matching, and payment and account loops bounded by the fields present. Parsing runs on untrusted chat text and in the service worker, so these bounds are load-bearing.
