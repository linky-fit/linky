# @linky-fit/proxy-payment

The proxy bank-payment domain: a scanned bank QR that contacts are asked to pay for sats.

The package parses and re-encodes bank QRs and holds the offer rules: a reducer that folds snapshots and send receipts into one authorized thread per peer and offer, selectors over that state, drafts for the next snapshot, and the stagger schedule for delayed recipients. `@linky-fit/linkstr` carries the kind 24135 snapshots between devices ([bank offers](../linkstr/docs/payment-kinds.md#bank-offers)).

## Design rules

- No React, Evolu, browser storage or i18n. Device state (lease locks, stored payloads, stagger queues) and user-facing labels stay in the consumer.
- Every function that compares against "now" takes `nowSec`; nothing in the package reads a clock.
- Offers are keyed by peer pubkey and offer id, never by contact id or chat row; the consumer maps pubkeys to contacts.
- The package never touches relays; linkstr supplies the snapshot facts and receipts. The wire text templates live here as fixed Czech copy, for clients that only display `text`.

## Guides

The exported types are the reference; the guides state the guarantees.

- [Offers](./docs/offers.md): applying snapshots and receipts, authorization, selectors, drafts, stagger scheduling
- [Bank QR](./docs/bank-qr.md): parsing and re-encoding SPD, EPC and PAY by square payments, editing, account normalization, decoding bounds
