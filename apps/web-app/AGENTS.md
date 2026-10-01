# @linky-fit/web-app

App policy on top of the packages. Package mechanics live in the package guides; these are the rules the app adds.

## Wallet

- Writing a cashu mnemonic wipes seed-bound device state whenever it differs from the readable one, including when none is readable (covers a logout that could not wipe).
- A new default mint is persisted only after the hosted npub.cash mint update succeeded.
- npub.cash claim, info and mint sync always target `https://npub.linky.fit`, whatever `lud16` the profile publishes. Upstream `<npub>@npub.cash` quotes are minted through `Topup.adopt` on the mint upstream chose and are not auto-swapped.
- `isHiddenTestMint` is the one test-mint predicate. Hidden test-mint proofs are filtered from balances and selection, never modified; the backup export and the Nostr bootstrap snapshot read the unfiltered proofs.
- Default mint and "Allow test mints" are synced `setting` rows, applied to the device automatically; the device writes them only on an explicit choice.
- Nullable amount and fee columns mean "not recorded" and render as absent, never `0 sat`.
- The auto-pay limit covers Lightning invoices and Cashu payment requests alike; amountless invoices always confirm; `bitcoin:` QRs prefer the Cashu leg.
- LNURL-auth is recognized before the withdraw/pay probes (they accept any HTTPS URL), persists nothing, sends its callback through the proxy first because the callback consumes `k1`, and requires an explicit `status: "OK"`. Linky signs logins for other sites and is never itself logged into this way.
- LNURL targets and callbacks require HTTPS, loopback included.
- Recovery-seed backup is `navigator.credentials.store()` or manual; the credential id is `linky.seed:<seed-derived npub>`, never the display name or a custom-nsec identity.

## Evolu boot

- Zero enabled Evolu servers is supported (local-only after reload). The installation migration adds `wss://evolu.linky.fit` once and is skipped when `VITE_EVOLU_SERVER_URLS` is set.
- OPFS unavailable or stalled pauses boot behind a consent prompt; only "Continue with temporary session" selects in-memory SQLite, remembered per tab.
- The one automatic wipe is the one-shot WASM-OOM recovery (`linky.evolu.autoWipeOnWasmOom.v1`). A broken OPFS pool is left in place (the sqlite-wasm patch pauses instead of deleting). Clearing is blocked while a quota error is present; Evolu keeps the error after another relay converges, so probes and dismissed warnings are not proof of recovery.

## Messaging

- `useLinkstrInboxSync` is the one wrap-inbox handler and holds app policy: blocked pubkeys, `unknown:<pubkeyHex>` threads, the custom-identity `since` cutoff (`switchedAtSec`). Toasts and notifications fire only for `delivery === "live"`.
- Unknown senders are never written as contacts; their threads live in the local overlay until the user adds them.
- Incoming rows store the rumor id in `wrapId`; an edit keeps the original message's id in `rumorId` (`editOf`) so reactions and replies keep resolving.
- Own messages reach other devices through Evolu; the linkstr echo only reconciles a pending row.
- `contact.name`/`lnAddress` always hold the effective value and the UI never reads the profile cache. `*SetByUser` flags mark overrides; profile sync clears a field only when the previously cached profile supplied exactly the current value, and never writes contact rows while a contact form route is open. Collision suffixes (short npub after a duplicate name) are presentation-only.
- Read state is cursor-based, never per-message columns. Cursors use message time, advance only in a visible tab and only forward. The seen-receipts toggle is off only as an explicit `"0"`; a removed key re-enables.
- Attachments have no caption field, so text goes as a separate message after the files. Received PDF bytes must start with `%PDF-`, peer file names are reduced to a basename with a forced `.pdf`, and pdfjs stays out of the SW precache.
- Chat payment requests are immutable on receive. Payment actions bind to content, rumor id, contact and amount, re-checked before spending and before delivery; queued payments never re-read an edited amount.
- Cashu token chat messages carry no push marker; the separate kind 24133 notice is the sole push trigger and is never stored in chat history.

## Bank (proxy) payments

- Offer state is transient, rebuilt from authenticated snapshots after reload; persisted chat JSON never authorizes a response or settlement.
- `bank_details_sent` goes to exactly one reserved recipient, reserved under a Web Lock; without `navigator.locks.query` only offers with `singleTabRiskAccepted` send. An ambiguous failure, late acceptance or reload never selects another recipient. The contact wrap publishes before the self copy. Only `canceled`/`settled` end an offer.
- Editing scanned fields re-encodes in the original format and re-parses; the currency is not editable (it selects the recipients); an SPD `CRC32` is dropped.

## Shell

- Navigate with `navigateTo()`. Back is `resolveBackAction()` for both the topbar and hardware back, because hash navigation only grows history and a cold-start deep link has nothing to return to.
- New `AuthenticatedLayout` modals join the `dismissTopModal` chain, else Android back navigates under the open dialog.
- First render uses local state; network catch-up waits for `useDeferredOnlineReady`.
- iOS caches the standalone chrome mode per origin across reinstall and data clears, so viewport experiments need a fresh origin.

## Security headers

- The CSP meta is injected at build (`server/contentSecurityPolicy.ts`). `vercel.json` and `docker/web-app/nginx.conf` send matching headers; the meta cannot supply framing restrictions, so self-hosts must preserve them through their TLS proxy.
- Evolu debug pages render `[redacted]` for every column not on the metadata allowlist.
