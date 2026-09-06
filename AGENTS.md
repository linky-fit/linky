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
- Branded ID types from Evolu (`ContactId`, `CashuTokenId`, `MintId`, etc.) - don't use plain strings
- Components use `interface` for props, not `type`
- New browser storage names use the `linky.` prefix (e.g., `linky.nostr_nsec`, `linky.lang`). Existing exceptions are listed in `docs/architecture.md` under "Compatibility and audit decisions"; preserve those names for upgrades.
- Use types from libraries (e.g., Evolu, Cashu, Nostr) instead of redefining them - look up the library's exported types first
- Prefer sparse Evolu mutation payloads: omit optional fields when empty instead of writing explicit `null` (especially `cashuToken` optional columns like `rawToken`, `mint`, `unit`, `amount`, `error`)
- Plain CSS in `App.css` - no CSS-in-JS or utility framework
- `localStorage` goes through `utils/storage.ts` (`safeLocalStorageGet/Set/Remove`, `safeLocalStorageGetJson` with a Schema); raw access is reserved for the one-time linkshu migration and the linkshu `KeyValueStore` port
- Validate stored and wire JSON with effect `Schema` (shared pieces in `utils/schema.ts`), not hand-rolled `typeof` guards
- `nowSeconds()` and `sleep()` come from `utils/time.ts`
- Translation keys are `I18nKey` and translators are `Translate` (both from `src/i18n`); `cs.ts` is the reference locale and `en.ts`/`de.ts` must `satisfies` its key set, so a missing or misspelled key is a type error, never a runtime fallback


### Commenting the code

- If you need to add comment to a code to justify the code being overcomplicated, the code is bad and you should do it differently - unless instructed otherwise or we specifically agree on going with this implementation. Good comments do not excuse unclear code.
- Comments should not duplicate the code! The code should be self explanatory, use function names, proper code split into logical chunks
- Explain unidiomatic code in comments - keep the comments brief and to the point if you need to write it!

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

`.github/workflows/e2e.yml` runs the `local-stack` project and site redemption/recovery tests on pull requests and every push to main, and is reused (`workflow_call`) as a required job by both Android release workflows. The Vercel production deploy is gated on the same `e2e` check via Deployment Checks in the Vercel dashboard.

Shared helpers live in `tests/helpers/`. Use `setSeedLoginStorage` when a test needs a real seed login (deterministic Evolu owner lanes); `setRandomIdentityStorage` is the cheaper "just be logged in" variant and leaves `isSeedLogin` false.

## Site E2E tests

`bun run --filter @linky/site test:e2e` uses the existing mints on :3338/:3339 and Nostr relay on :7777, and builds the site on :5180 with `VITE_ALLOW_TEST_MINT=1`.

## linkshu integration tests

`packages/linkshu` has a second vitest project (`tests/integration/`, excluded from `bun run test`) that needs both dev-stack mints: `docker compose -f docker-compose.dev.yml up -d --wait cashu-mint cashu-mint-target`, then `bun run --filter @linky/linkshu test:integration`. CI runs it as the `linkshu-integration` job in `.github/workflows/tests.yml`.

## linkshu CLI wallet

`apps/linkshu-cli` is a terminal wallet on `@linky/linkshu` — run it with `bun run linkshu <command>` from the repo root. It is also the package's platform-independence proof, so keep it free of browser/React/Evolu imports. Its own tests use `bun test` (not vitest) and need no mint; driving actual wallet commands does (`docker compose -f docker-compose.dev.yml up -d --wait cashu-mint`). See `apps/linkshu-cli/README.md`.

## Gotchas

- Evolu requires a Worker polyfill in test environments (jsdom + polyfill live in `vitest.setup.ts`)
- Vitest excludes `tests/**` — that directory holds only the Playwright suites plus `tests/helpers` and `tests/fixtures`; unit tests live next to their subject under `src/`
- linkstr test helpers (`makeIdentity`, publish stubs, `FakeRelay`, `eventually`, `stubStorage`) live in `packages/linkstr/src/testing`, exported as `@linky/linkstr/testing` and excluded from the app build; `packages/linkstr-react/src/testing` adds `settle`/`configWith`/`fakeTransport`. Extend them instead of redeclaring fixtures per test file, and never import them from production code
- In this workspace/Bun setup, `bunx --cwd apps/web-app playwright test tests` can resolve incorrectly; run `cd apps/web-app && bunx playwright test tests` instead
- Playwright cannot intercept requests made by a service worker, and `src/sw.ts` has a Workbox `CacheFirst` route for image destinations that matches cross-origin URLs — any test stubbing remote images must use `serviceWorkers: "block"`
- Payment integration tests use source mint :3338 and target mint :3339, with separate keys and databases. `cashu-mint-target` starts with the `integration` or `e2e` profile. Use the target mint for payable invoices; the source mint auto-pays its own quotes, so same-mint tests race its three-second timer
- Evolu quota recovery tests use the isolated :4002 relay from the `e2e` or `quota` profile, capped at 16 KiB per owner. The normal :4001 relay defaults to unlimited; `EVOLU_OWNER_QUOTA_BYTES=0` means unlimited, and a positive value limits encrypted history bytes per owner.
- The local Nginx server accepts the password-save form POST only at `/password-save.html` and serves the empty static document. Keep this exception scoped so other unsupported POST requests still fail
- The local Nginx server must serve `.mjs` as JavaScript; PDF previews load a module worker and fail when it is served as `application/octet-stream`
- The local Nutshell mint charges `input_fee_ppk: 100`, so it is **not** fee-free; a receiver nets slightly less than the amount sent
- The dev mint runs with `MINT_RATE_LIMIT=FALSE`; nutshell's defaults (60 requests/minute globally, 20/minute for transactions) answer 429 partway through any full integration run
- The `nostr-rs-relay` image's `/bin/sh` is dash, so its healthcheck must invoke `bash` explicitly for `/dev/tcp`
- `nostr-tools` is patched via Bun `patchedDependencies` (`patches/nostr-tools@2.23.3.patch`): the browser keepalive REQ uses `limit: 1` because nostr-rs-relay silently ignores `limit: 0` REQs, so the unanswered ping killed every healthy connection ~every 50s. The ping code is duplicated into every `lib/` entry bundle (13 files) — when bumping nostr-tools, re-apply to all copies or drop the patch if upstream fixed it, and verify at runtime (a partial patch still sends `limit: 0`). Dockerfiles that run `bun install` must `COPY patches` first
- `docker/web-app/Dockerfile` copies every workspace `package.json` before `bun install --frozen-lockfile`; adding a new workspace without adding its manifest COPY there breaks the e2e image build
- SQLite WASM files served from `public/sqlite-wasm/` with `cache-control: no-store` in dev
- Debug APKs install side-by-side as `fit.linky.app.debug`; native push in them requires a `fit.linky.app.debug` client in `google-services.json` (register that package in the Firebase console), otherwise the google-services plugin is skipped for debug-only builds and push is unsupported
- Play upload bundles require release signing via `apps/native-shell/android/keystore.properties` (template: `keystore.properties.example` next to it) or `LINKY_UPLOAD_STORE_FILE` / `LINKY_UPLOAD_STORE_PASSWORD` / `LINKY_UPLOAD_KEY_ALIAS` / `LINKY_UPLOAD_KEY_PASSWORD`; `bun run native:aab:release` fails fast when those credentials are missing
- Dev mode now keeps the registered PWA service worker alive for push testing; use `#advanced/push-debug` to inspect persistent client/SW push logs and manually reset service workers/caches when needed
- The pinned versions in `docker/evolu-relay/package.json` must stay protocol-compatible with the web app's `@evolu/common` — check upstream `apps/relay/CHANGELOG.md` when bumping Evolu packages
- Outbound HTTP in `apps/site/api/` must go through `safeFetch` from `api/_safeFetch.ts` (resolve → validate → pinned connect, manual redirects); a raw `fetch` there reintroduces the SSRF hole, and the target must be `https:` on a public host, so an `http://localhost` `NPUBCASH_BASE_URL` is rejected by design
- `apps/push/.env.development` and `apps/web-app/.env.development` are intentionally committed (localhost-only config; the VAPID keypair in there is dev-only, never reuse it in production)

## Maintaining This File

IMPORTANT: Keep this file up to date. When you make changes that affect conventions or operational gotchas, update the relevant section here in the same commit. Architectural decisions belong in `docs/architecture.md`, not here. Also keep `README.md` current when a change affects what it describes (features, auth model, development setup). Keep all of these files brief and current.
