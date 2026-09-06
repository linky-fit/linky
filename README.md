# Linky

Linky is a mobile-first PWA for contacts, Nostr messaging, and Lightning/Cashu payments.
It is local-first: data is stored in Evolu (SQLite) and syncs between devices.

The repo also contains a separate public website in `apps/site/` intended for `linky.fit`, while the product app remains a distinct deployment on `app.linky.fit`. Its `/cashu/` redemption page uses the shared linkshu wallet and linkstr delivery packages, with local recovery for interrupted payments.

## Protocols and stack

- Nostr (chat, profile, auth-related flows)
- Evolu (local-first DB + sync)
- Cashu + mints (Lightning wallet flow)
- npub.cash (LN address + mint preference sync on Linky's own server; payments to `<npub>@npub.cash` are collected from upstream too)

## Authentication model

- Login supports either:
  - `nsec`, or
  - one 20-word **SLIP-39** share
- With SLIP-39 login:
  - Nostr keypair is derived at `m/44'/1237'/0'/0/0`
  - deterministic Evolu owner lanes are derived for:
    - contacts (`contacts-n`)
    - cashu (`cashu-n`)
    - messages (`messages-n`)
    - owner metadata (`ownerMeta`)
- If user pastes custom `nsec` during a SLIP-39 session, app switches to pasted key locally without immediate Evolu restore/write; choosing Derive switches back to seed-derived key.

## Owner rotation and limits

Constants live in `apps/web-app/src/utils/constants.ts`; the mechanics are in `docs/architecture.md` ("Evolu persistence and owner lanes").

- Each Evolu owner lane rotates on its own historical mutation threshold: contacts `220`, cashu `170`, messages `160`, transactions `220` (`*_OWNER_ROTATION_TRIGGER_WRITE_COUNT`), with a per-scope `OWNER_ROTATION_COOLDOWN_MS = 60_000` cooldown.
- Existing quota failures need relay capacity before rejected history can sync. Keep the device's local data, increase the relay's quota or add a relay with capacity, then reload normally.
- Rotation is pointer-only for every scope: the active lane index moves forward in `ownerMeta`, nothing is copied, and older lanes stay readable instead of being pruned.
- Contacts are additionally capped at `MAX_CONTACTS_PER_OWNER = 100` per active lane; a full lane triggers rotation to the next one.

## Features

- Contacts: add/edit/delete, QR scan/share, grouping
- Messages: encrypted private chat (gift-wrap/NIP-17 flows)
- Wallet: Cashu token ingest, restore, validation, spend
- Lightning address receive: payments to `<npub>@linky.fit` and `<npub>@npub.cash` both land in the wallet, whatever address the profile advertises
- Payments:
  - Lightning invoice and LN address payment
  - contact payment via Cashu message flow
  - proxy payment of a scanned bank QR (SPD, EPC, PAY by square) with editable fields before the offer is sent
- Push: optional Bun push service in `apps/push/` for generic Web Push notifications on new outer inbox `kind: 1059` events
- Debug pages for Evolu current/history data and owner/rotation diagnostics

## Development

Requirements: Bun; Docker for the local dev service stack

For Android native builds: Java 17

### Local dev vs prod services

- `bun run dev` — full local environment: starts `docker-compose.dev.yml` (local Nostr relay :7777, Evolu sync relay :4001, Cashu Nutshell **FakeWallet** mint :3338 that auto-settles invoices with fake sats), then runs the web app (:5173) and push service (:8787) against it via the committed `.env.development` files. npub.cash flows are disabled locally (#219); the mint has no real Lightning backend (#220).
- `bun run dev:prod` — web app only, on :5175, against production services. The separate port keeps browser storage isolated from local-dev sessions.
- `bun run dev:services` — just the docker stack, attached.
- The `e2e` and `quota` Compose profiles also start an isolated Evolu relay on :4002 with a 16 KiB per-owner quota for recovery tests. The normal :4001 relay stays unlimited unless `EVOLU_OWNER_QUOTA_BYTES` sets a positive byte limit.

### linkshu CLI wallet

`apps/linkshu-cli/` is a terminal cashu wallet and `@linky/linkshu`'s first consumer — it runs
under plain Bun with file-based implementations of all three platform ports, which is how the
package's independence from the browser stays honest. It needs the dev stack's mint:

```bash
docker compose -f docker-compose.dev.yml up -d --wait cashu-mint
bun run linkshu --help
bun run linkshu --data-dir /tmp/wallet topup 128
bun run linkshu --data-dir /tmp/wallet balance
```

Commands: `balance`, `topup`, `receive`, `send`, `melt`, `restore`. See
[`apps/linkshu-cli/README.md`](./apps/linkshu-cli/README.md) for the data directory layout, seed
handling, and the port implementations.

### Dev inspector

While the dev server runs, the domain-agnostic inspector shows events on open, namespaced channels.
Current Nostr emitters use `nostr.operation` (linky-level linkstr operations and routed inbox facts)
and `nostr.wire` (raw relay traffic — publishes, subscriptions, incoming events). Rows are
correlated by shared ids in their `links` (gift-wrap ids, rumor ids, optimistic-update client ids),
while non-correlating location metadata such as relay urls lives in `context`. Development builds
collect automatically until the setting is explicitly turned off.

1. Start the app (`bun run dev` or `bun run dev:prod`).
2. Open `http://localhost:5173/inspector.html` (`:5175` for `dev:prod`) in a window next to the app
   — not as a route inside the app.
3. Use the app; rows stream in live. Selecting a row highlights every related row and the detail
   pane lists them (click to jump) — e.g. one `reactions.react` operation and the two
   `WirePublished` wraps it produced.

The same timeline is available in-app at `#advanced/inspector/timeline`. All inspector controls
live on one settings page at `#advanced/inspector` (reached from Advanced → Inspector): the
collection toggle, the persistent-log toggle with download/clear, the timeline link, and the
Push/SW debug page. Production builds collect only after enabling **Inspector** there. The in-app
buffer can contain decrypted message payloads in plain text, stays in browser memory only, and is
cleared on reload or when the setting is turned off. Production collection never sends inspector
rows to a server. An independent toggle on the same page can retain the same plain-text rows in
on-device browser storage for up to 24 hours (about 25 MiB) and download them as import-compatible
`.ndjson`.

Toolbar: channel chips and a text filter narrow the timeline; **Pause** freezes the view while
still buffering; **Clear** resets the collector; the timeline auto-follows the newest row until you
scroll up (**Follow ↓** jumps back). When several app tabs report, an **App** selector appears.
**Import** loads `.ndjson`, `.jsonl`, or `.txt` captures entirely in the browser and switches the
timeline offline; close the displayed file name to discard it and reconnect to the live feed.

Programmatic access:

```bash
# poll as JSON; cursor in the response resumes the next call
# optional filters: channel=<lowercase dotted token>, client=<per-tab app id>
curl "http://localhost:5173/__inspector/events?cursor=0&channel=nostr.wire"

# live SSE stream / reset between scenarios
curl -N "http://localhost:5173/__inspector/stream"
curl -X POST "http://localhost:5173/__inspector/clear"

# or tail the append-only file (one JSON row per line, reset on dev-server start)
tail -f apps/web-app/.inspector/rows-5173.ndjson
```

```bash
bun install
bun run dev
bun run site:dev
bun run push:dev
```

Build:

```bash
bun run build
bun run site:build
```

### Native shells

Android APK/AAB builds, signing, Firebase push setup, and the iOS project are documented in
[`apps/native-shell/README.md`](./apps/native-shell/README.md). The root `native:*` scripts
(`bun run native:apk:debug`, `bun run native:apk:release`, `bun run native:aab:release`, ...) forward
to that workspace. Native push delivery additionally needs `apps/push` configured with
`PUSH_FIREBASE_SERVICE_ACCOUNT_JSON`.

Start the push service once:

```bash
bun run push:start
```

### Tests

Unit tests (Vitest) across all workspaces:

```bash
bun run test
```

`@linky/linkshu` additionally has an integration suite against the local
docker mints (started via `docker compose -f docker-compose.dev.yml up -d
--wait cashu-mint cashu-mint-target`): `bun run --filter @linky/linkshu test:integration`.

`@linky/linkshu-cli` runs its port and argument-parsing tests under `bun test` (no mint needed);
they are part of `bun run test`.

End-to-end tests (Playwright) live in `apps/web-app/tests/*.spec.ts`.
The `local-stack` runs the proxy-payment flow — three accounts on one machine, talking over the local
Nostr relay and paying each other with the local Cashu mint — plus the linkshu storage-migration
scenario, chat/edit/offline-reaction and top-up recovery, and signup with a real password-save
form submission. Attachment tests send encrypted images and PDFs between browsers and verify
decryption, seen receipts, downloads, and bytes handed to the browser sharing API. Owner-lane
tests verify old and new contacts, messages, transactions, and tokens across devices and reloads.
Boot and route tests cover fresh profiles, restore, unavailable browser storage, and navigation.
The full suite and site redemption tests run on pull requests and pushes to main.
Payments use separate local mints on :3338 and :3339. It needs the
docker stack up first, because the app is served from it as a production build on :5176:

```bash
docker compose -f docker-compose.dev.yml --profile e2e up -d --build --wait
cd apps/web-app && bunx playwright test --project=local-stack
```

Re-run the `up --build` after changing app source; the endpoints are baked into the image.

To watch or debug a run:

```bash
bunx playwright test --project=local-stack --ui                 # step through it
bunx playwright test --project=local-stack --headed             # three live browsers
bunx playwright show-trace test-results/*local-stack/trace.zip  # after the fact
```

Every run records a trace containing all three accounts, and the console output of each app is
printed prefixed with its account label (`[A]`, `[B]`, `[C]`). The run takes ~20s, so `--ui` and the
trace viewer are far more useful than watching it live.

In CI, `local-stack` gates every release: it runs on each push to main (Vercel Deployment Checks
holds the production promotion until it passes) and as a required job in both Android release
workflows.

### Code quality

Always run the full check pipeline after changes:

```bash
bun run check-code
```

This runs:

1. `typecheck`
2. `eslint --fix`
3. `prettier --write`

Workspace-scoped commands (web app only):

```bash
bun run --filter @linky/web-app typecheck
bun run --filter @linky/web-app eslint
bun run --filter @linky/web-app prettier
```

Workspace-scoped commands (public site only):

```bash
bun run --filter @linky/site dev
bun run --filter @linky/site build
bun run --filter @linky/site preview
bun run --filter @linky/site test:e2e
```

The site smoke suite needs the local mints on 3338/3339 and Nostr relay on 7777. It builds and serves the site on 5180, enabling test-mint redemption only for that build. It covers direct and proxied LNURL payments plus reload recovery after lost swap and melt responses.

Workspace-scoped commands (native shell):

```bash
bun run --filter @linky/native-shell android:sync
bun run --filter @linky/native-shell android:open
bun run --filter @linky/native-shell android:apk:debug
```

Push service workspace commands:

```bash
bun run --filter @linky/push typecheck
bun run --filter @linky/push start
```

Push service container artifacts live in `apps/push/`:

- `Dockerfile` builds a production Bun image
- `docker-compose.example.yml` shows a persistent SQLite `/data` volume for prod-style deployment
- `.env.production.example` lists the runtime env vars expected by that compose setup

## License

Linky is released under the Zero-Clause BSD license (`0BSD`). See
[`LICENSE`](./LICENSE).
