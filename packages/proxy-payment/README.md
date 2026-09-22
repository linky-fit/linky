# @linky/proxy-payment

The proxy bank-payment domain: you scanned a bank QR and ask contacts to pay it for sats. `@linky/linkstr` carries the kind 24135 snapshots between devices; this package owns everything above the wire and below the UI:

- **Bank QR parsing** (`bankQr/`) — SPD, EPC and PAY by square payloads to one field map and back, CZ/SK domestic account numbers to IBAN, editable-field rules.
- **Offer rules** (`offers/status.ts`, `offers/offer.ts`) — status roles, terminal states, merge precedence, phase expiry, response windows and the recipient/stagger limits.
- **The reducer** (`offers/state.ts`) — authenticated snapshots and this device's send receipts in, one authorized thread per peer and offer out. Offerer snapshots establish the terms; payer snapshots only advance them and are held back until their offerer's snapshot arrives.
- **Selectors** (`offers/selectors.ts`) — who is still active, what the offerer's auto-responder owes each offer, when each offer expires, which threads a cancellation reaches.
- **Drafts** (`offers/drafts.ts`) — the next `BankOfferDraft` for a thread, refusing statuses the sender's role may not send.
- **Stagger** (`offers/stagger.ts`) — delayed recipients as a pure schedule over the first send's expiry.

Environment-agnostic: no React, Evolu, browser storage or i18n. See [`docs/`](./docs/README.md) for usage and [`AGENTS.md`](./AGENTS.md) for the rules.
