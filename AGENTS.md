# Linky

Mobile-first PWA for contacts, Nostr messaging, and Lightning/Cashu payments. Local-first architecture using Evolu for offline storage and cross-device sync.

See @README.md for project overview.

Package manager is **Bun** (not npm/yarn/pnpm); scripts are defined in the root `package.json`. Workspace filter: `bun run --filter @linky/web-app <script>`.

IMPORTANT: Always run `bun run check-code` after making changes. It runs typecheck first, then eslint and prettier which autofix what they can. If typecheck or non-autofixable eslint errors remain, fix them manually and re-run until all checks pass.

Native Android builds require Java 17. `apps/native-shell/scripts/with-java17.sh` prefers an installed macOS JDK 17 automatically before running Capacitor/Gradle commands, and `apps/native-shell/scripts/patch-android-java.sh` rewrites Capacitor-generated Android compile options from Java 21 to Java 17 after add/sync.

## Architecture

Architectural decisions and behavioral constraints are documented in `docs/architecture.md`. Read the relevant sections there before changing app structure, data flow, persistence, or protocols.

IMPORTANT: When you make or change an architectural decision, document it in `docs/architecture.md` in the same commit — not in this file. This file only holds commands, conventions, testing, and operational gotchas.

## Code Conventions

- TypeScript strict mode with `exactOptionalPropertyTypes`
- **NEVER use `as` or `any` to cast types** - validate with a runtime type guard instead of casting
- Branded ID types from Evolu (`ContactId`, `CashuProofId`, `CashuOperationId`, `MintId`, etc.) - don't use plain strings
- Components use `interface` for props, not `type`
- New browser storage names use the `linky.` prefix (e.g., `linky.nostr_nsec`, `linky.lang`). Existing exceptions are listed in `docs/architecture.md` under "Compatibility and audit decisions"; preserve those names for upgrades.
- Use types from libraries (e.g., Evolu, Cashu, Nostr) instead of redefining them - look up the library's exported types first
- Prefer sparse Evolu mutation payloads: omit optional fields when empty instead of writing explicit `null` (the linksync wallet repository and the legacy `cashuToken` columns follow this)
- Plain CSS in `App.css` - no CSS-in-JS or utility framework
- `localStorage` goes through `utils/storage.ts` (`safeLocalStorageGet/Set/Remove`, `safeLocalStorageGetJson` with a Schema); raw access is reserved for the one-time linkshu migration and the linkshu `KeyValueStore` port
- Validate stored and wire JSON with effect `Schema` (shared pieces in `utils/schema.ts`), not hand-rolled `typeof` guards
- `nowSeconds()` and `sleep()` come from `utils/time.ts`
- Translation keys are `I18nKey` and translators are `Translate` (both from `src/i18n`); `cs.ts` is the reference locale and `en.ts`/`de.ts` must `satisfies` its key set, so a missing or misspelled key is a type error, never a runtime fallback


### Commenting the code

- If you need to add comment to a code to justify the code being overcomplicated, the code is bad and you should do it differently - unless instructed otherwise or we specifically agree on going with this implementation. Good comments do not excuse unclear code.
- Comments should not duplicate the code! The code should be self explanatory, use function names, proper code split into logical chunks
- Explain unidiomatic code in comments - keep the comments brief and to the point if you need to write it!

## Package docs

`packages/linkshu/docs/`, `packages/linkstr/docs/`, and `packages/linksync/docs/` hold usage guides for the three libraries (linkstr-react is documented in `packages/linkstr/docs/react.md`; linksync's scope table in `packages/linksync/docs/concepts.md` is the source of truth for owner types, rotation rules, and forget policies). Read the relevant guide before using or changing a package, and follow the package's `AGENTS.md`: a change to an exported surface or documented behavior updates the matching guide in the same commit.

## Inspector events

When implementing or refactoring a meaningful operation — user-initiated actions, network/relay/mint traffic, sync, push, notable state transitions — emit an inspector event for it. Follow the `adding-inspector-events` skill (`.agents/skills/adding-inspector-events/`) for row design, correlation links, and the no-key-material rule.

## Release Versioning

[CalVer](https://calver.org) `YY.MM.MICRO`: short year, month (no leading zero), release counter starting at `1` that resets monthly — e.g. August 2026: `26.8.1`, `26.8.2`, `26.8.3`.

Exception: August 2026 accidentally shipped as `26.9.0`, so keep releasing as `26.9.MICRO` (bump `MICRO` each release) through both August and September 2026 — do not reset the counter in September. Normal scheme resumes with `26.10` in October 2026; delete this paragraph then.

## Local dev environment

- `bun run dev` starts the local service stack (`docker-compose.dev.yml`: Nostr relay :7777, Evolu relay :4001, FakeWallet mint :3338) detached, then the web app (:5173) and push service (:8787) against it; requires Docker
- `bun run dev:prod` runs the web app on :5175 against production services (no local stack needed)
- `bun run dev:services` runs just the docker stack attached (Ctrl-C stops it)
- See the "Local dev environment" section in `docs/architecture.md` for how env overrides and vite modes work

## E2E tests

The `local-stack` project in `apps/web-app/playwright.config.ts` runs the suites listed in `LOCAL_STACK_SPECS` against the Docker stack. The app is served as a **production build** on :5176; bring the stack up first.

```bash
# once, and again after changing app source (VITE_* values are inlined at build time)
docker compose -f docker-compose.dev.yml --profile e2e up -d --build --wait

cd apps/web-app
bunx playwright test --project=local-stack                      # run it
bunx playwright test --project=local-stack --ui                 # step through by test.step()
bunx playwright test --project=local-stack --headed             # three live browsers
bunx playwright show-trace test-results/*local-stack/trace.zip  # after the fact
bunx playwright show-report
```

The default reporter prints every `[linky]` console line prefixed with the account label (`[A]`, `[B]`, `[C]`); passing `--reporter=line` suppresses the HTML report. `trace: "on"` for this project, so every run — pass or fail — leaves one trace bundle containing all three accounts (switch between them with the page selector).

The run is ~20s, so `--headed` mostly shows a blur; `--ui` and the trace viewer are the useful tools. Do not reintroduce a slow-motion knob: a per-action delay pushes the top-up quote and the offer's phase timers past their deadlines, so the test fails for reasons unrelated to the code under test.

`.github/workflows/e2e.yml` runs the `local-stack` project and site redemption/recovery tests on pull requests and every push to main, and is reused (`workflow_call`) as a required job by the Android release workflow. The Vercel production deploy is gated on the same `e2e` check via Deployment Checks in the Vercel dashboard.

Shared helpers live in `tests/helpers/`. Use `setSeedLoginStorage` when a test needs a real seed login (a deterministic Evolu app owner, so the shards derive the same on every device); `setRandomIdentityStorage` is the cheaper "just be logged in" variant and leaves `isSeedLogin` false.

`tests/shards.spec.ts` is the shard suite: it rotates every scope from `#evolu-current-data` (buttons named `Rotate <scope> shard`), checks the pointer on a second device, edits a shard-0 contact and reads its copy in shard 1 through `window.__linkyE2E.shardRows`, sends and tops up across the rotation, then rotates messages to index 4 and boots a fresh device that must see only the newest 4 message shards (`forget()` and `syncOwnerIds()` on the hook expose the store's view). Keep those assertions when touching rotation, copy-on-write or forgetting.

The compose image is built with `VITE_E2E=1`, which makes `main.tsx` install `window.__linkyE2E` (`src/devtools/e2e/installLinkyE2eHooks.ts`): raw Evolu upserts under any owner, `useOwners` for legacy lane mnemonics, `shardRows(scope, table)` for what the linksync shards hold, `shardOwnerId(scope, index)`, `syncOwnerIds()` and `forget()`. `lane-migration.spec.ts` seeds legacy lane rows through it instead of the UI, so it keeps working after the app stops writing to the lanes. When building the image by hand, pass `--build-arg VITE_E2E=1`; production builds never set it.

## Site E2E tests

`bun run --filter @linky/site test:e2e` uses the existing mints on :3338/:3339 and Nostr relay on :7777, and builds the site on :5180 with `VITE_ALLOW_TEST_MINT=1`.

## linkshu integration tests

`packages/linkshu` has a second vitest project (`tests/integration/`, excluded from `bun run test`) that needs both dev-stack mints: `docker compose -f docker-compose.dev.yml up -d --wait cashu-mint cashu-mint-target`, then `bun run --filter @linky/linkshu test:integration`. CI runs it as the `linkshu-integration` job in `.github/workflows/tests.yml`.

## linkshu CLI wallet

`apps/linkshu-cli` is a terminal wallet on `@linky/linkshu` — run it with `bun run linkshu <command>` from the repo root. It is also the package's platform-independence proof, so keep it free of browser/React/Evolu imports. Its own tests use `bun test` (not vitest) and need no mint; driving actual wallet commands does (`docker compose -f docker-compose.dev.yml up -d --wait cashu-mint`). See `apps/linkshu-cli/README.md`.

## Gotchas

- Evolu requires a Worker polyfill in test environments (jsdom + polyfill live in `vitest.setup.ts`)
- Vitest excludes `tests/**` — that directory holds only the Playwright suites plus `tests/helpers` and `tests/fixtures`; unit tests live next to their subject under `src/`
- linkstr test helpers (`makeIdentity`, publish stubs, `FakeRelay`, `eventually`, `stubStorage`) live in `packages/linkstr/src/testing`, exported as `@linky/linkstr/testing` and excluded from the app build; `@linky/linkstr-react/testing` adds `settle`/`configWith`/`fakeTransport` the same way. Extend them instead of redeclaring fixtures per test file, and never import them from production code
- In this workspace/Bun setup, `bunx --cwd apps/web-app playwright test tests` can resolve incorrectly; run `cd apps/web-app && bunx playwright test tests` instead
- Playwright cannot intercept requests made by a service worker, and `src/sw.ts` has a Workbox `CacheFirst` route for image destinations that matches cross-origin URLs — any test stubbing remote images must use `serviceWorkers: "block"`
- Payment integration tests use source mint :3338 and target mint :3339, with separate keys and databases. `cashu-mint-target` starts with the `integration` or `e2e` profile. Use the target mint for payable invoices; the source mint auto-pays its own quotes, and nutshell's FakeWallet reports a quote as paid on the first status poll regardless of `FAKEWALLET_DELAY_INCOMING_PAYMENT`, so a top-up's QR can disappear within tens of milliseconds
- The Evolu `cashuToken` table is read-only legacy input: only the lane migration reads it (`app/migrations/legacyTokenRow.ts` normalizes rows for linkshu's `Tokens.ingestLegacyRows`); never write a `cashuToken` row from app code, and never read it outside the migration. The wallet's stores are `@linky/linksync`'s `makeWalletRepository`; app code never picks an owner id for a cashu write
- Transactions are read and written only through `@linky/linksync`'s transactions repository (`app/hooks/useLinksync.ts`); never query or mutate the `transaction` table with Evolu from app code outside the lane migration, and never write `category` or `phase`. Rows built for the repository carry the package's branded column types (`PositiveInt`, `NonEmptyString100`, ...); decode optional inputs with the type's `from` and omit what does not fit instead of throwing
- Messages, reactions and the identity follow the same rule: `useMessagesDomain` writes through the conversations repository's `messages`/`reactions` (after `ensureDirect`), `useProfileAuthDomain` through `useIdentityRepository`; the `nostrMessage`/`nostrReaction`/`ownerMeta` tables and the query-inferred row types in `evolu.ts` are read only by the lane migration. No app code calls `evolu.useOwner`, `useQuery` or Evolu's `upsert`/`insert`/`update` any more; `@evolu/*` is imported by `evolu.ts`, the migration and test fixtures only, everything else takes the package's re-exports (`NonEmptyString1000`, `sqliteTrue`, `createIdFromString`, `OwnerId`, ...) from `@linky/linksync`
- Contacts and conversations follow the same rule: `useContactsRepository`/`useConversationsRepository` (or the repository passed down as a parameter) are the only writers, the contact row is `@linky/linksync`'s `ContactRow` joined with its direct conversation's state (`app/lib/contactChatState.ts`), and the legacy chat columns on `contact` (`archivedAtSec`, `chatLastSeenAtSec`, `chatPeerSeen*`) are read only by the lane migration. A new contact gets its id from `createId<"Contact">()` before the insert runs, so callers can navigate at once; `app/lib/storeWrite.ts` (`runWrite`) turns a failed repository write into status text. Archive, the read cursor and the peer seen window are conversation writes (`ensureDirect` first; the id is `directConversationIdFor(contactId)`), never contact writes
- Evolu quota recovery tests use the isolated :4002 relay from the `e2e` or `quota` profile, capped at 16 KiB per owner. The image defaults to 100 MiB per owner, while development Compose explicitly keeps :4001 unlimited; `EVOLU_OWNER_QUOTA_BYTES=0` means unlimited, and a positive value limits encrypted history bytes per owner.
- Push HTTPS delivery imports `undici/index.js` explicitly because Bun 1.3.9 shadows bare `undici` and its `node:https` shim loses hostname verification with pinned DNS. Keep the actual TLS tests passing under the Docker/CI Bun version when changing this transport.
- Push deployments behind a reverse proxy must set `PUSH_TRUSTED_PROXY_IPS` to the exact peer IPs seen by the service and have those proxies append or replace `X-Forwarded-For`; the default trusts no forwarding headers, so proxied clients otherwise share a rate-limit bucket.
- Production-build CSP permits local HTTP/WS services only with `VITE_ALLOW_INSECURE_LOCALHOST_RELAYS=1`. Keep CSP active in E2E; keep nginx security headers at server scope so cache headers cannot override their inheritance.
- The local Nginx server must serve `.mjs` as JavaScript; PDF previews load a module worker and fail when it is served as `application/octet-stream`
- The local Nutshell mint charges `input_fee_ppk: 100`, so it is **not** fee-free; a receiver nets slightly less than the amount sent
- The dev mint uses `MINT_RATE_LIMIT=FALSE` for HTTP and a high `MINT_TRANSACTION_RATE_LIMIT_PER_MINUTE` for NUT-17 WebSocket subscriptions. Nutshell 0.20.3's `limit_websocket` calls `assert_limit` directly and ignores the HTTP switch, so the default 20/minute still interrupts multi-browser E2E runs
- The `nostr-rs-relay` image's `/bin/sh` is dash, so its healthcheck must invoke `bash` explicitly for `/dev/tcp`
- `bysquare@4.0.0` is patched in both `src/pay/decode.ts` (Bun) and `lib/pay/decode.js` (browser): bound input and decoded text, reject zero/short LZMA output lengths, and bound payment/account loops by available fields. Keep both entry paths covered when upgrading; run `bysquareSafety.test.ts` and `spdPayment.test.ts`.
- `nostr-tools` is patched via Bun `patchedDependencies` (`patches/nostr-tools@2.23.3.patch`): the browser keepalive REQ uses `limit: 1` because nostr-rs-relay silently ignores `limit: 0` REQs, so the unanswered ping killed every healthy connection ~every 50s. The ping code is duplicated into every `lib/` entry bundle (13 files) — when bumping nostr-tools, re-apply to all copies or drop the patch if upstream fixed it, and verify at runtime (a partial patch still sends `limit: 0`). Dockerfiles that run `bun install` must `COPY patches` first
- `docker/web-app/Dockerfile` and `apps/push/Dockerfile` copy every workspace `package.json` before `bun install --frozen-lockfile`; adding a workspace under `apps/`, `packages/`, or `tools/` requires its manifest COPY in both Dockerfiles
- SQLite WASM files served from `public/sqlite-wasm/` with `cache-control: no-store` in dev
- Debug APKs install side-by-side as `fit.linky.app.debug`; native push in them requires a `fit.linky.app.debug` client in `google-services.json` (register that package in the Firebase console), otherwise the google-services plugin is skipped for debug-only builds and push is unsupported
- Play upload bundles require release signing via `apps/native-shell/android/keystore.properties` (template: `keystore.properties.example` next to it) or `LINKY_UPLOAD_STORE_FILE` / `LINKY_UPLOAD_STORE_PASSWORD` / `LINKY_UPLOAD_KEY_ALIAS` / `LINKY_UPLOAD_KEY_PASSWORD`; `bun run native:aab:release` fails fast when those credentials are missing
- Dev mode now keeps the registered PWA service worker alive for push testing; use `#advanced/push-debug` to inspect persistent client/SW push logs and manually reset service workers/caches when needed
- The pinned versions in `docker/evolu-relay/package.json` must stay protocol-compatible with the web app's `@evolu/common` — check upstream `apps/relay/CHANGELOG.md` when bumping Evolu packages
- Outbound HTTP in `apps/site/api/` must go through `safeFetch` from `api/_safeFetch.ts` (resolve → validate → pinned connect, manual redirects); a raw `fetch` there reintroduces the SSRF hole, and the target must be `https:` on a public host, so an `http://localhost` `NPUBCASH_BASE_URL` is rejected by design
- `apps/push/.env.development` and `apps/web-app/.env.development` are intentionally committed (localhost-only config; the VAPID keypair in there is dev-only, never reuse it in production)

## Maintaining This File

IMPORTANT: Keep this file up to date. When you make changes that affect conventions or operational gotchas, update the relevant section here in the same commit. Architectural decisions belong in `docs/architecture.md`, not here. Also keep `README.md` current when a change affects what it describes (features, auth model, development setup). Keep all of these files brief and current.
