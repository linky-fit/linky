# @linky-fit/proxy-payment

Read [`docs/offers.md`](./docs/offers.md) before changing the offer rules; it states the authorization order, the merge precedence and the selector contracts a consumer's effects rely on. Design rules are in the [README](./README.md).

## Rules that are easy to break

- Every function that compares against "now" takes `nowSec`; nothing in the package reads a clock.
- `applyBankPaymentOfferReceipt` trusts the receipt's content but applies the same staleness rules as `applyBankPaymentOfferSnapshot` (`isStaleFor`); a new rule goes into both paths.
- The offerer's `accepted_by_other` overriding a pending `accepted` regardless of timestamp is deliberate; do not restore plain timestamp order.
- When upgrading `bysquare`, keep the bounds from `patches/bysquare@4.0.0.patch` and run `src/bankQr/bysquareSafety.test.ts`.
