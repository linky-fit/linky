# Architecture

Constraints and decisions the code cannot tell you. Record the constraint, not the change; history belongs in git.

Package mechanics live in the package guides: `packages/linkstr/docs/`, `packages/linkshu/docs/`, `packages/linksync/docs/` (scope rules: `packages/linksync/src/model/scopes.ts`) and `packages/proxy-payment/docs/`. This file only holds what the app and its deployments must not violate.

## Package boundaries

- Code that needs an owner id, a table name or a shard index belongs in `@linky-fit/linksync`; Nostr wire shapes belong in `@linky-fit/linkstr`; cashu state transitions belong in `@linky-fit/linkshu`. The app never derives a shard owner, never picks an owner for a write, and imports `nostr-tools` only in tests (devDependency).
- linkshu's `KeyValueStore` adapter (localStorage, `linky.linkshu.*`) is device-local and never synced: counters, restore cursors, seen mints, leases and the fee-probe cache only. Anything another device needs goes into the wallet repository.
- `@linky-fit/identity` owns derivation only (SLIP-39, BIP-32/85) and takes its key types from linkstr; it has no `nostr-tools` dependency.
- `@linky-fit/proxy-payment` takes `nowSec` as an argument and has no React, Evolu, browser storage or i18n. Offer storage stays an app module until a second platform needs it; `utils/bip321.ts` and `utils/spdPayment.ts` stay in the app (browser share and service-worker APIs). The package's wire text templates are fixed Czech copy for clients that only display `text`.
- `apps/linkshu-cli` lives in `apps/` because nothing imports it; it is the proof that linkshu runs without a browser, React or Evolu. Its file ports raise on undecodable content and never reset a wallet: a silent reset is indistinguishable from losing every token.
- `tools/nostr-error-tracker` syncs only append-only resolution records through Evolu; raw reports and the seed never enter Evolu, and it never publishes Nostr events.

## Money

- `cashuProof` and `cashuOperation` rows are never deleted. `spent` is terminal (restore and re-ingest dedupe against it); a proof is spent if any shard copy, live or tombstoned, says so.
- Only NUT-07-confirmed `UNSPENT` proofs are offered for spending. `PENDING` and unanswered states are never persisted; only `spent` is.
- Pending topup, melt and autoswap operations are retired only on the mint's own answer, never on the local clock alone: a quote can be paid while the device is offline.
- The melt operation and its `held` inputs are written before the melt request leaves, so any device can settle it through `Melt.resumePending`; an unsettled melt is `PaymentPending`, never a failure that frees the inputs.
- Funds move between mints only on explicit user action; changing the default mint never moves balances.
- A shard rotation whose pointer write fails must not fail the row write: a linkshu operation dying between storing outputs and marking inputs spent corrupts the wallet, a missed rotation only delays.
- Writing a cashu mnemonic wipes seed-bound device state whenever it differs from the readable one, including when none is readable (covers a logout that could not wipe).
- Amounts the input fee would consume are refused before any inventory change, on send and on receive (`AmountConsumedByFee`).
- A new default mint is persisted only after the hosted npub.cash mint update succeeded.
- One mint per payment; a payment is never split across mints.
- Test mints: `isHiddenTestMint` is the one predicate. Hidden test-mint proofs are filtered from balances and selection, never modified; the backup export and the Nostr bootstrap snapshot read the unfiltered proofs.
- Deterministic counters are device-local; a new origin restores the seed and the synced inventory and reconciles counters with the mint through collision recovery.
- No Linky server sits between the wallet and a mint; quote ids and proofs never pass through Linky infrastructure.
- Site `/cashu`: fake-Lightning test mints are rejected before an invoice is fetched; leftover token value is forwarded to the collector, and only a failed forward hands it back to the user.

## Identity and secrets

- The cashu seed is BIP-85 `m/83696968'/39'/0'/24'/0'`, the error-tracker owner `.../24'/7'/0'`. Derivation is a cross-app contract with Payky: `packages/identity/src/crossAppDerivation.test.ts` is mirrored there; change both or neither.
- LNURL-auth linking keys derive from the active Nostr secret key (`packages/identity/src/lnurlAuth.ts`), deliberately not LUD-05, so pasted-nsec logins work; switching identity switches every LNURL-auth account. Linky signs logins for other sites and is never itself logged into this way.
- The recovery seed never enters an HTTP request; backup is `navigator.credentials.store()` or manual. The credential id is `linky.seed:<seed-derived npub>`, never the display name or a custom-nsec identity.
- npub.cash claim, info and mint sync always target `https://npub.linky.fit`, whatever `lud16` the profile publishes. Upstream `<npub>@npub.cash` quotes are minted through `Topup.adopt` on the mint upstream chose and are not auto-swapped.
- A custom-nsec session ignores inner events older than the stored `switchedAtSec`.
- NUT-20 locking keys are passed into `adopt`/`resumePending` and never persisted; `submitLnurlAuth` takes a `sign` callback so no key material enters linkshu.
- Native shells hold secrets through the platform bridge; secrets are never logged.

## Evolu storage and shards

- The app never names an owner id, table or shard index: reads and writes go through the linksync repositories in `app/hooks/useLinksync.ts`. The lane migration's grace-period `useOwner` and the `VITE_E2E` hook are the only other Evolu callers.
- `linky.shards.retainedFrom.*` is device-local: never synced or exported. A fresh device's pointer window stays provisional until the bootstrap gate calls `retainVisibleShards()`.
- Default mint and "Allow test mints" are synced `setting` rows: the setting is applied to the device automatically, the device writes the setting only on an explicit choice.
- Nullable amount and fee columns mean "not recorded" and render as absent, never `0 sat`.
- Zero enabled Evolu servers is supported (local-only after reload). The installation migration adds `wss://evolu.linky.fit` once and is skipped when `VITE_EVOLU_SERVER_URLS` is set.
- OPFS unavailable or stalled pauses boot behind a consent prompt; only "Continue with temporary session" selects in-memory SQLite, remembered per tab. Nothing degrades silently.
- No code path wipes local Evolu data automatically except the one-shot WASM-OOM recovery (`linky.evolu.autoWipeOnWasmOom.v1`). A broken OPFS pool is left in place (the sqlite-wasm patch pauses instead of deleting) and clearing is a user action.
- Quota errors are recovered by adding relay capacity, never by wiping local data; clearing is blocked while a quota error is present. Evolu keeps the error after another relay converges, so probes and dismissed warnings are not proof of recovery.
- Keep the core-js polyfills in their own chunk ahead of vendor and injected into the Evolu worker: Evolu calls `Set.prototype.difference` at module init in both.
- The boot probe in `main.tsx` queries `ownerMeta`; move it before that legacy table is removed.

## Nostr messaging

- linkstr is the app's only Nostr surface. One wrap-inbox handler (`useLinkstrInboxSync`) holds app policy: blocked pubkeys, `unknown:<pubkeyHex>` threads, the custom-identity `since` cutoff. Interruptions (toasts, notifications) fire only for `delivery === "live"`.
- Incoming rows store the rumor id in `wrapId`; an edit keeps the original message's id in `rumorId` (`editOf`) so reactions and replies keep resolving.
- An own-message echo (`OwnChatMessageConfirmed`) only reconciles a pending row; an echo with no match is dropped, never appended. Evolu is the cross-device path for own messages.
- Unknown senders are never written as contacts; their threads live in the local overlay until the user adds them.
- Profile state comes from the live `ProfileWatch` subscription, with no TTL or refresh; the cache ignores facts not strictly newer than `updatedAt`.
- `contact.name`/`lnAddress` always hold the effective value and the UI never reads the profile cache. `*SetByUser` flags mark overrides; profile sync clears a field only when the previously cached profile supplied exactly the current value, and never writes contact rows while a contact form route is open.
- Collision suffixes (short npub after a duplicate name) are presentation-only, never written back.
- Read state is cursor-based on both sides, never per-message columns. Cursors use message time, never wall clock, advance only in a visible tab, and are forward-only. A received `seenUpToSec` is clamped to now + 1 day; an absent seen check means nothing.
- Seen-receipts toggle: off is an explicit `"0"`; a removed key re-enables. Receipts send direct, not through the Outbox: each supersedes the last, so a retried stale cursor would be wrong.
- Attachments have no caption field, so text goes as a separate message after the files. Received PDF bytes must start with `%PDF-`, peer file names are reduced to a basename with a forced `.pdf`, and pdfjs stays out of the SW precache. Older clients drop PDFs; no fallback text is sent.
- Chat payment requests are immutable on receive. Payment actions bind to content, rumor id, contact and amount, re-checked before spending and before delivery; queued payments never re-read an edited amount.
- Payment telemetry uses a fresh ephemeral key per send and carries no push marker.
- Relay URLs are WSS only; loopback WS only with `VITE_ALLOW_INSECURE_LOCALHOST_RELAYS=1` (app) or `PUSH_ALLOW_INSECURE_LOCALHOST_RELAYS=1` (push).
- Author filters are chunked at `AUTHOR_FILTER_LIMIT`, never one query per npub: relays silently truncate large `authors` lists.
- Inspector rows never leave the device in production; the in-memory and IndexedDB sinks hold decrypted plaintext.

## Proxy (bank) payments

- Offer state is transient, rebuilt from authenticated snapshots after reload; persisted chat JSON never authorizes a response or settlement.
- `bank_details_sent` goes to exactly one reserved recipient (reservation under a Web Lock; without `navigator.locks.query` only offers with `singleTabRiskAccepted` send). An ambiguous failure, late acceptance or reload never selects another recipient. The contact wrap publishes before the self copy. Only `canceled`/`settled` end an offer.
- Bank QR parsing runs on untrusted chat text and in the service worker; the bounds in `packages/proxy-payment/docs/bank-qr.md` and the bysquare patch are load-bearing.
- Editing scanned fields re-encodes in the original format and re-parses; the currency is not editable (it selects the recipients); an SPD `CRC32` is dropped.

## Wallet and payments

- The auto-pay limit covers Lightning invoices and Cashu payment requests alike; amountless invoices always confirm; `bitcoin:` QRs prefer the Cashu leg.
- LNURL-auth is recognized before the withdraw/pay probes (they accept any HTTPS URL), persists nothing, sends its callback through the proxy first because the callback consumes `k1`, and requires an explicit `status: "OK"`.
- LNURL targets and callbacks require HTTPS, loopback included.

## Push and notifications

- Sender-controlled relay hints are ignored everywhere; notification-triggered fetches use configured read relays only.
- Cashu token chat messages carry no push marker; the separate kind 24133 notice is the sole push trigger and is never stored in chat history.
- `/platba.spayd`: only the body comes from the URL; MIME, filename, disposition, `nosniff` and the sandbox CSP are fixed.
- The push service never decrypts NIP-17: it emits only for outer kind 1059 wraps tagged `["linky","push"]`; `/subscribe` and `/unsubscribe` need a kind 27235 proof per pubkey. Delivery is pinned-DNS public HTTPS on 443, no redirects, bounded body and deadline; `PUSH_TRUSTED_PROXY_IPS` is the only way forwarded IPs are honored.

## Web shell

- Navigate with `navigateTo()`, never `window.location`.
- First render prefers local state; network catch-up waits for `useDeferredOnlineReady`.
- New `AuthenticatedLayout` modals join the `dismissTopModal` chain, else Android back navigates under the open dialog.
- Back is `resolveBackAction()` for both the topbar and hardware back; never `history.back()` (hash navigation only grows history, and a cold-start deep link has nothing to return to).
- Keep Manrope's OFL in `public/licenses` when updating fonts.
- iOS: never declare `apple-mobile-web-app-status-bar-style` (dead band on iOS 26). iOS caches the chrome mode per origin across reinstall and data clears, so viewport experiments need a fresh origin.

## Security headers and diagnostics

- CSP meta is injected at build (`server/contentSecurityPolicy.ts`): scripts `'self'` + `'wasm-unsafe-eval'` + inline hashes, no eval. HTTP/WS is admitted for localhost only, and only with `VITE_ALLOW_INSECURE_LOCALHOST_RELAYS=1`.
- `vercel.json` and `docker/web-app/nginx.conf` send matching headers (frame-ancestors none, X-Frame-Options DENY, no-referrer, nosniff, HSTS, Permissions-Policy); self-hosts must preserve them through their TLS proxy. The meta cannot supply framing restrictions.
- Boot diagnostics redact any run of 12+ words (mnemonic-shaped) and drop URL query and hash before storing or exporting; the redactor is compiled into `index.html` so it works when the bundle fails.
- Evolu debug pages render `[redacted]` for every column not on the metadata allowlist.
- `apps/site`: no manifest, no service worker, no install prompt. Tokens travel in the hash, never the query string. All outbound HTTP in `apps/site/api/` goes through `safeFetch` (public HTTPS hosts, pinned connect, manual redirects, 64 KiB, 12 s); `/api/lnurlp` returns no CORS headers, and the app's LNURL proxy allows only `https://localhost` and `capacitor://localhost`.

## Native shells

- Bundled `dist` by default; live reload only with `LINKY_CAP_SERVER_URL`.
- File export on native writes to the app cache and hands to `@capacitor/share`; the WebView has no `blob:` download and no `navigator.share`.
- Android release `versionCode` from CI is `200000000 + run_number` (composite action); the Gradle formula is the local fallback only.
- `android:allowBackup="false"` stays.

## Storage-name upgrade contracts

- Keep `linky_use_btc_symbol`, `linky_debug_evolu_sql`, `linky_nostr_profile_v2:`, `linky_nostr_status_v2:`, `linky_nostr_avatar_cache_v1`, `linky-push-debug-v1`, `linky-push-secrets-v1` and `linky-push-contact-names-v1`; renaming needs a page + service-worker migration.
- `linky.show_profile_qr_on_tilt.v1` is abandoned; only `.v2` `"0"` means off.

## Migration removal gates

- Earliest review 26.10.1. Remove only with evidence that every supported upgrade source completed the migration, or an enforced bridge upgrade with recovery for offline devices; a release date or absence of reports is not evidence. Covers `linkshuStorageMigration` (`linky.linkshu_storage_migration_v1`), `legacyAcceptedTokenDrain`, `MESSAGE_MIGRATION_VERSION`, `.migratedToEvolu.v2` and linkstr's decoding of older persisted outbox receipts. Remove each reader, flag, fixture and test together.
- Lane-to-shard migration (`app/migrations/laneToShardMigration.ts`, `useLaneToShardMigration.ts`, the legacy tables and columns in `evolu.ts`, `tests/lane-migration.spec.ts`, the `VITE_E2E` lane-seeding hook, the `evolu.migration` inspector events): removable 180 days after the first production release carrying it, plus the evidence above. The cutoff is a `setting` row, first writer wins, so every device agrees. Extending the grace period is a one-constant change; shortening strands rows. There is deliberately no watermark: a late-syncing older row would be skipped. The spent-state mirror to legacy owners is the only legacy write.
- `wipeLinkshuSeedBoundState` stays; only its migration prologue is eligible.

## Dev and test

- Env vars change only fresh-origin defaults; relay and Evolu server lists are user settings. Distinct dev ports keep local-dev and prod-services storage origin-isolated.
- Nutshell has no stochastic-failure knob; use the `FAKEWALLET_*` variables in `docker-compose.dev.yml`.
- `docker/evolu-relay` pins Evolu versions that must stay protocol-compatible with the app's `@evolu/common`; the official relay image is not used because it hardcodes a 1 MB per-owner quota.
