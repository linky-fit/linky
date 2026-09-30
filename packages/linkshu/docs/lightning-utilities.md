# Lightning utilities

Helpers that need no wallet runtime: preview a bolt11 invoice, size retry amounts, resolve LNURL-pay/withdraw/auth and lightning addresses, and fetch fiat rates. None of them use Effect; the network ones return Promises and throw plain `Error`s.

## Example

```ts
import {
  Bolt11Invoice,
  fetchLnurlInvoiceForTarget,
  getLightningInvoicePreview,
  isLightningAddress,
} from "@linky-fit/linkshu";

const invoiceFor = async (target: string, amountSat: number) => {
  if (!isLightningAddress(target)) throw new Error("not a lightning address");
  const { pr, successAction } = await fetchLnurlInvoiceForTarget(
    target,
    amountSat,
    "thanks",
  );
  const preview = getLightningInvoicePreview(pr);
  return {
    invoice: Bolt11Invoice.make(pr), // the branded type MeltDraft takes
    amountSat: preview?.amountSat ?? null,
    successAction,
  };
};
```

`Bolt11Invoice.make` throws on text that does not start with `ln`; decode with `Schema.decodeUnknownOption(Bolt11Invoice)` when the text is untrusted. The result feeds [`Melt`](./melt.md).

## Invoice preview

| Export                                           | Returns                           | Notes                                                                                                                                                  |
| ------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getLightningInvoicePreview(raw)`                | `LightningInvoicePreview \| null` | `{ amountSat, description, expiresAtSec, invoice }`; null unless the text starts with `lnbc`/`lntb`/`lnbcrt`. Missing expiry → 1 h after the timestamp |
| `getPayableLightningInvoice(raw)`                | `PayableLightningInvoice \| null` | checksum-checked decode; requires a positive amount, payment hash, and signature; `amountSat` and `expiresAtSec` non-null                              |
| `parseBolt11AmountMsat(invoice)`                 | `number \| null`                  | amount from the human-readable part                                                                                                                    |
| `getLightningInvoiceDescriptionHashHex(invoice)` | `string \| null`                  | the `h` tag as hex, to verify LNURL metadata                                                                                                           |

The preview decodes fields for display and never verifies the signature. `getPayableLightningInvoice` bounds input to 5 000 characters and rounds `amountSat` up from msat; the caller still compares `expiresAtSec` with the clock, and the mint validates the rest.

## Amount fallback

When a requested amount plus fees does not fit the balance, an LNURL target can be re-fetched at a lower amount. The package supplies the ladder; the retry loop is yours.

| Export                                                          | Use                                                                                                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `buildPaymentAmountAttempts(requestedSat, availableSat)`        | `[requested]` normally; when the request equals the whole balance, a descending list leaving `0, 1, 2, 3, 5, 8, 13, 21` sat as fee room |
| `buildPaymentFailureAmountAttempts(requestedSat, errorMessage)` | lower amounts to try after a retryable failure: first the parsed shortage, then the fee ladder                                          |
| `isRetryablePaymentAmountFailure(errorMessage)`                 | matches "insufficient funds", "not enough funds", "amount out of lnurl range", …                                                        |
| `getPaymentAmountShortage(errorMessage)`                        | parses `provided: X, needed: Y`, `need X, have Y`, or `fee: N`                                                                          |

These work on error messages. `Melt` itself fails with a typed `InsufficientFunds` carrying `required`/`available`; render that as `need X, have Y` before feeding it here.

## LNURL-pay and withdraw

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

`fallback: LnurlFallback = (url) => Promise<Response>` is tried when the direct fetch fails, for example a CORS proxy. Fixed-amount LNURLs that re-quote in fiat are followed within 2 % drift.

Every LNURL target and callback must be HTTPS, bech32-encoded and `lnurlp://`/`lnurlw://`/`keyauth://` ones included; loopback HTTP is rejected. Redirects are followed manually, up to three hops, HTTPS checked before each. Browsers hide redirect destinations, so those requests go through the fallback, which must enforce HTTPS itself and should return a non-2xx response rather than throw: the package reads a `status: "ERROR"` body under any HTTP status and reports its `reason`.

### LNURL-withdraw

The withdrawing service pays an invoice you give it, so the invoice comes from a [topup](./topup.md):

```ts
import {
  fetchLnurlWithdrawPreview,
  redeemLnurlWithdraw,
} from "@linky-fit/linkshu";
import type { TopupHandle } from "@linky-fit/linkshu";

/** `startTopup` runs `Topup.start` on your runtime. */
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

## LNURL-auth

LUD-04 logs the user into a third-party site. The whole request is in the scanned URL (`tag=login` plus the `k1` challenge), so `parseLnurlAuthTarget` recognizes a login without a network call. The linking key is the user's, so the package never holds it: `submitLnurlAuth` asks your `sign` for a signature over the challenge and appends `sig`/`key` to the LNURL's own query.

```ts
import { parseLnurlAuthTarget, submitLnurlAuth } from "@linky-fit/linkshu";

const login = async (scanned: string) => {
  const preview = parseLnurlAuthTarget(scanned);
  if (!preview) return null; // not a login target
  // Show `preview.domain` and `preview.action` and get consent before signing.
  await submitLnurlAuth({
    preview,
    sign: ({ challengeHex, domain }) => signLinkingKey(challengeHex, domain),
  });
  return preview.domain;
};
```

| Export                             | Returns                    | Notes                                                                                                                    |
| ---------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `parseLnurlAuthTarget(text)`       | `LnurlAuthPreview \| null` | accepts `lnurl1…`, `keyauth://`, and plain https; `{ action, domain, k1, requestUrl }`, no network                       |
| `isLnurlAuthTarget(text)`          | `boolean`                  | the same check without the preview                                                                                       |
| `submitLnurlAuth(args, fallback?)` | `Promise<void>`            | sends the callback once; resolves only on an explicit `status: "OK"`, throws the service's `reason` on `status: "ERROR"` |

The callback consumes the challenge, so it is sent exactly once, and a given `fallback` goes first (a direct browser request can succeed while CORS hides the response, and a retry would land on a used `k1`); the direct request runs only when the fallback could not be reached. `action` (`login`, `register`, `link`, `auth`; default `login`) is the site's own word for what the login does; show it. `LnurlAuthSigner` returns `{ publicKeyHex, signatureHex }`: the compressed secp256k1 linking key and a DER-encoded ECDSA signature.

## Lightning address helpers

`isLightningAddress`, `splitLightningAddress` → `{ user, domain } | null`, `stripLightningPrefix`, and `getLightningAddressRequestUrl` (lowercases user and domain; LUD-16 servers reject mixed case). All four are on the main entry, and the same module is exported as `@linky-fit/linkshu/lightning-address` for bundles that must not pull in cashu-ts or Effect.

## Fiat rates

| Export                         | Use                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `FiatRates`                    | Schema/type: `chfPerBtc`, `czkPerBtc`, `eurPerBtc`, `usdPerBtc`, `fetchedAtMs` |
| `fetchFiatRates(signal)`       | Coinbase BTC rates → `FiatRates \| null` (null on HTTP or shape errors)        |
| `decodeFiatRates(raw)`         | parse a cached JSON string                                                     |
| `isFiatRatesStale(rates)`      | older than `FIAT_RATES_TTL_MS` (10 min) or null                                |
| `FIAT_RATES_CACHE_STORAGE_KEY` | storage key for the cached JSON                                                |

## Errors

| Source                   | Failure shape                                                                               | What to do                                 |
| ------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------ |
| preview / amount helpers | `null` or an empty array                                                                    | treat as "unknown"; they never throw       |
| LNURL fetchers           | thrown `Error` (message from the server's `reason` when present) or `LnurlTagMismatchError` | show the message; try the `fallback` proxy |
| `fetchFiatRates`         | `null`, or a rejected promise on abort/network                                              | keep the last cached value                 |

## Related

- [melt.md](./melt.md), [topup.md](./topup.md)
- [errors.md](./errors.md): why these are not tagged errors
