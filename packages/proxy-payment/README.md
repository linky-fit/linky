# @linky-fit/proxy-payment

The proxy bank-payment domain: a scanned bank QR that contacts are asked to pay for sats. `@linky-fit/linkstr` carries the kind 24135 snapshots between devices (wire format: linkstr's [bank-offers guide](../linkstr/docs/payment-kinds.md#bank-offers)); this package owns everything above the wire and below the UI:

- **Bank QR parsing** (`bankQr/`) — SPD, EPC and PAY by square to one field map and back, CZ/SK account numbers to IBAN, editable-field rules.
- **Offer rules** (`offers/status.ts`, `offers/offer.ts`) — status roles, terminal states, merge precedence, phase expiry, recipient and stagger limits.
- **The reducer** (`offers/state.ts`) — snapshots and send receipts in, one authorized thread per peer and offer out.
- **Selectors** (`offers/selectors.ts`) — active offers, the offerer's responder work, expiries, cancellation targets.
- **Drafts** (`offers/drafts.ts`) — the next `BankOfferDraft` for a thread, refusing statuses the sender's role may not send.
- **Stagger** (`offers/stagger.ts`) — delayed recipients as a pure schedule.

## Design rules

- Environment-agnostic: no React, Evolu, browser storage or i18n. Device state (lease locks, stored payloads, stagger queues) and user-facing labels stay in the consumer; the package takes `nowSec` as an argument and never reads a clock.
- Offers are keyed by peer pubkey and offer id, never by contact id or chat row; the consumer maps pubkeys to contacts at its edge.
- `@linky-fit/linkstr` supplies the snapshot facts, drafts and receipts only; the package never touches relays. The wire text templates live here because every outgoing draft needs them.

## Documentation

The exported types are the API reference; the guides show usage and state the guarantees.

- [Offers](./docs/offers.md) — the offer model, applying snapshots and receipts, authorization, selectors, drafts, stagger scheduling
- [Bank QR](./docs/bank-qr.md) — parsing and re-encoding SPD, EPC and PAY by square payments, editing, account normalization, decoding safety bounds
