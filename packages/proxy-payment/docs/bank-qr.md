# Bank QR

`parseBankPayment(text)` recognizes the three bank QR formats Linky supports and returns one shape:

```ts
import { parseBankPayment, tryParseBankPayment } from "@linky/proxy-payment";

const payment = parseBankPayment(
  "SPD*1.0*ACC:CZ6508000000192000145399+GIBACZPX*AM:250*CC:CZK",
);
payment.format; // "spd" | "epc" | "bysquare"
payment.fields; // { ACC: "CZ65…", BIC: "GIBACZPX", AM: "250", CC: "CZK" }
payment.payload; // the trimmed input

tryParseBankPayment("hello"); // null
```

| Format     | Recognized by              | Notes                                                                         |
| ---------- | -------------------------- | ----------------------------------------------------------------------------- |
| `spd`      | `SPD*` prefix              | `ACC:IBAN+BIC` is split into `ACC` and `BIC`; values are percent-decoded      |
| `epc`      | `BCD` first line           | SEPA credit transfer, EUR only; the account must be a valid IBAN              |
| `bysquare` | base32hex payload, 16–4096 | decoded with the patched `bysquare/pay`; only `PaymentOrder` payments qualify |

Every parser throws an `Error` whose message is a stable code (`spd-missing-account`, `bank-payment-invalid-epc`, `bank-payment-unsupported`, …); the app maps codes to translated messages. `isBankPaymentPayload(text)` is the cheap classifier for scanned or pasted text, and `getBankPaymentOfferCurrency(text)` returns `"CZK"`, `"EUR"` or `null` — the currency decides which contacts can be asked to pay.

## Editing

`getBankPaymentEditableFieldKeys(format)` lists the fields a user may change in display order (the amount is edited separately, the currency never). `updateBankPaymentFields(payment, edits)` normalizes each edit — accounts through `normalizeBankAccountInput` (IBAN mod-97 or a CZ/SK `prefix-number/bank` account with mod-11 checks), amounts to `d+(.dd)`, BICs by pattern — re-encodes the payment in its original format and re-parses it, so the result is a payload a bank app can read. An SPD `CRC32` is dropped because it authenticated the original string. Failures throw the same stable codes (`bank-payment-invalid-account`, `bank-payment-invalid-amount`, `bank-payment-invalid-bic`).

`formatDomesticBankAccount(iban)` renders CZ/SK IBANs the way their banks display them (`19-2000145399/0800`) and returns `null` for any other country.

## Safety

PAY by square decoding is bounded in the patched dependency (`patches/bysquare@4.0.0.patch`): at most 4096 encoded characters, a positive declared decompressed size, exact output-size matching, and payment/account loops bounded by the available fields. `src/bankQr/bysquareSafety.test.ts` pins those bounds; run it when upgrading `bysquare`.
