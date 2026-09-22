# @linky/proxy-payment guides

How to use Linky's proxy bank-payment domain library. These are guides, not an API reference: the exported types are the reference, and the [package README](../README.md) holds the design rules.

- [Offers](./offers.md) — the offer model, applying snapshots and receipts, the selectors behind the app's effects, drafts and stagger scheduling
- [Bank QR](./bank-qr.md) — parsing and re-encoding SPD, EPC and PAY by square payments, account normalization

The wire format lives in linkstr's [bank-offers guide](../../linkstr/docs/bank-offers.md).
