# Lightning utilities

Helpers that need no wallet runtime: preview a bolt11 invoice, size retry amounts, resolve LNURL-pay and lightning addresses, and fetch fiat rates. None of them use Effect; the network ones return Promises and throw plain `Error`s.

## Quick example

Prerequisites: none beyond network access; the result feeds [`Melt`](./melt.md), which needs a configured runtime.

```ts
import {
  Bolt11Invoice,
  fetchLnurlInvoiceForTarget,
  getLightningInvoicePreview,
  isLightningAddress,
} from "@linky/linkshu";

const invoiceFor = async (target: string, amountSat: number) => {
  if (!isLightningAddress(target)) throw new Error("not a lightning address");
  const { pr, successAction } = await fetchLnurlInvoiceForTarget(
    target,
    amountSat,
    "from linky",
  );
  const preview = getLightningInvoicePreview(pr);
  return {
    invoice: Bolt11Invoice.make(pr), // the branded type MeltDraft takes
    amountSat: preview?.amountSat ?? null,
    successAction,
  };
};
```

`Bolt11Invoice.make` throws on text that does not start with `ln`; decode with `Schema.decodeUnknownOption(Bolt11Invoice)` when the text is untrusted.

## Invoice preview (`invoice/preview.ts`)

| Export                                           | Returns                           | Notes                                                                                                                                                      |
| ------------------------------------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getLightningInvoicePreview(raw)`                | `LightningInvoicePreview \| null` | `{ amountSat, description, expiresAtSec, invoice }`; null unless the text starts with `lnbc`/`lntb`/`lnbcrt`. Missing expiry tag → 1 h after the timestamp |
| `parseBolt11AmountMsat(invoice)`                 | `number \| null`                  | amount from the human-readable part, rounded up to whole msat                                                                                              |
| `getLightningInvoiceDescriptionHashHex(invoice)` | `string \| null`                  | the `h` tag as hex; used to verify LNURL metadata                                                                                                          |

These are permissive by design: they decode fields for display and never verify the signature or authorize a payment.

## Amount fallback (`invoice/paymentAmountFallback.ts`)

For LNURL targets, the app can re-fetch the invoice at a lower amount when the requested amount plus fees does not fit the balance. The package supplies the ladder; the retry loop stays app-side (`useLightningPaymentsDomain.ts`).

| Export                                                          | Use                                                                                                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `buildPaymentAmountAttempts(requestedSat, availableSat)`        | `[requested]` normally; when the request equals the whole balance, a descending list leaving `0, 1, 2, 3, 5, 8, 13, 21` sat as fee room |
| `buildPaymentFailureAmountAttempts(requestedSat, errorMessage)` | lower amounts to try after a retryable failure: first the parsed shortage, then the fee ladder                                          |
| `isRetryablePaymentAmountFailure(errorMessage)`                 | matches "insufficient funds", "not enough funds", "amount out of lnurl range", …                                                        |
| `getPaymentAmountShortage(errorMessage)`                        | parses `provided: X, needed: Y`, `need X, have Y`, or `fee: N`                                                                          |

These work on error _messages_. `Melt` itself fails with a typed `InsufficientFunds` carrying `required`/`available`; render that (Linky's `describeTaggedCashuError` produces `need X, have Y`) before feeding it here.

## LNURL-pay and withdraw (`lnurl/lnurlPay.ts`)

| Export                                                                      | Use                                                                                                                    |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `isLnurlPayTarget(value)`                                                   | lightning address, bech32 `lnurl1…`, `lnurlp://`, or https URL                                                         |
| `resolveLnurlPayRequestUrl(value)`                                          | the LUD-06 request URL; throws on invalid input                                                                        |
| `getLnurlPayDisplayText(value)`                                             | short label for UI                                                                                                     |
| `inferLightningAddressFromLnurlTarget(value)`                               | `user@host` when derivable                                                                                             |
| `fetchLnurlPayPreview(target, fallback?)`                                   | `LnurlPayPreview`: `callback`, min/max sat and msat, `description`, `commentAllowed`, `metadataRaw`                    |
| `fetchLnurlInvoiceForTarget(target, amountSat, comment?, fallback?)`        | `LnurlPayInvoiceResult { pr, lightningAddress, successAction }`; verifies the metadata hash and amount (LUD-06 step 7) |
| `isLnurlWithdrawTarget`, `fetchLnurlWithdrawPreview`, `redeemLnurlWithdraw` | LUD-03 withdraw; recipe below                                                                                          |
| `LnurlTagMismatchError`                                                     | thrown when the server's `tag` is not the expected one                                                                 |

`fallback: LnurlFallback = (url) => Promise<Response>` is tried when the direct fetch fails — Linky routes through its `/api/lnurlp` proxy for CORS-blocked servers (`apps/web-app/src/lnurlPay.ts`). Fixed-amount LNURLs that re-quote in fiat are followed within 2 % drift.

### LNURL-withdraw

The withdrawing service pays an invoice you give it, so the invoice comes from a [topup](./topup.md): preview the offer, open a topup for an amount inside its range, hand the topup's invoice to the callback, and let the topup handle complete on its own.

```ts
import { fetchLnurlWithdrawPreview, redeemLnurlWithdraw } from "@linky/linkshu";
import type { TopupHandle } from "@linky/linkshu";

/** `startTopup` runs `Topup.start` on your runtime (see topup.md). */
const withdraw = async (
  target: string,
  startTopup: (amountSat: number) => Promise<TopupHandle>,
) => {
  const preview = await fetchLnurlWithdrawPreview(target);
  const handle = await startTopup(preview.amountSat);
  await redeemLnurlWithdraw({
    callback: preview.callback,
    k1: preview.k1,
    invoice: handle.quote.invoice,
  });
  return handle; // `handle.result` resolves once the service has paid
};
```

`LnurlWithdrawPreview` also carries `minAmountSat`/`maxAmountSat` and `description` for an amount picker. `redeemLnurlWithdraw` resolves when the service accepted the request, not when the payment arrived; that is the topup's result.

## Lightning address helpers (`lnurl/lightningAddress.ts`)

`isLightningAddress`, `splitLightningAddress` → `{ user, domain } | null`, `stripLightningPrefix`, `getLightningAddressRequestUrl` (lowercases user and domain; LUD-16 servers reject mixed case). All four are on the main entry.

The same file is also exported as **`@linky/linkshu/lightning-address`**. Use the subpath when the importing code must not pull cashu-ts or Effect into its bundle — the web app's `utils/lightningAddress.ts` and the site's serverless functions.

## Fiat rates (`fiatRates.ts`)

| Export                         | Use                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `FiatRates`                    | Schema/type: `chfPerBtc`, `czkPerBtc`, `eurPerBtc`, `usdPerBtc`, `fetchedAtMs` |
| `fetchFiatRates(signal)`       | Coinbase BTC rates → `FiatRates \| null` (null on HTTP or shape errors)        |
| `decodeFiatRates(raw)`         | parse a cached JSON string                                                     |
| `isFiatRatesStale(rates)`      | older than `FIAT_RATES_TTL_MS` (10 min) or null                                |
| `FIAT_RATES_CACHE_STORAGE_KEY` | storage key for the cached JSON                                                |

`useFiatRates.ts` shows the loop: read cache → if stale, fetch → write cache → repeat every TTL.

## Errors

| Source                   | Failure shape                                                                               | What to do                                 |
| ------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------ |
| preview / amount helpers | `null` or an empty array                                                                    | treat as "unknown"; never throw            |
| LNURL fetchers           | thrown `Error` (message from the server's `reason` when present) or `LnurlTagMismatchError` | show the message; try the `fallback` proxy |
| `fetchFiatRates`         | `null`, or a rejected promise on abort/network                                              | keep the last cached value                 |

## Related

- [melt.md](./melt.md)
- [topup.md](./topup.md) — LNURL-withdraw redeems against a topup invoice
- [errors.md](./errors.md) — why these are not tagged errors
