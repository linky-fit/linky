# Linky

Mobile-first PWA for contacts, Nostr messaging and Lightning/Cashu payments, local-first on Evolu. Bun workspace (`bun`, never npm/yarn/pnpm); scripts live in the root `package.json`, workspace-scoped ones run as `bun run --filter @linky-fit/web-app <script>`.

Always run `bun run check-code` after changes (typecheck, then eslint and prettier with autofix); fix what remains and re-run until it passes.

Architectural constraints sit at the narrowest place that covers them: cross-cutting invariants below, app policy in `apps/web-app/AGENTS.md`, package rules in each package's `AGENTS.md`, a single-file constraint in a comment beside that code. Record a new one there in the same commit: the constraint, not the change; history belongs in git. This file holds commands, conventions and gotchas. Keep it and `README.md` current and brief.

Domain vocabulary lives in `GLOSSARY.md`; read it before discussing domain concepts. When the user uses a term listed under _Avoid_ or in a sense that conflicts with its definition, point it out and propose the glossary term; when their meaning stays unclear, ask. Record newly settled terms there.

Emit an inspector event for every meaningful operation (user actions, relay/mint/sync/push traffic, notable state transitions); follow the `adding-inspector-events` skill.

## Documentation

`packages/*/docs/` are the usage guides for linkshu, linkstr (with linkstr-react), linksync and proxy-payment. Read the guide before using or changing a package and follow the package's `AGENTS.md`, which defines when the guides count as in sync. A change to an exported surface or documented behavior updates that package's docs in the same commit; most other changes need none.

- Guides are written for a consumer of the package: what to call, in which order, what each call guarantees, which errors to expect and how to recover. Before adding a paragraph, ask what a consumer would get wrong without it.
- The exported types and their doc comments are the reference. Guides link to exported symbols and leave field lists, method catalogs, internal control flow, `src/` paths and change history to the code and git.
- An explanation that concerns one function belongs in a comment beside it; a guide covers what crosses functions: lifecycles, guarantees, how operations combine.
- When documented behavior changes, rewrite or remove the affected text so the guide describes only the current behavior. A new guide needs a distinct operation or integration concern and a link from the package's guide index (`docs/README.md`, else `README.md`); anything smaller is a section in an existing guide.

## Invariants

- Owner ids, table names and shard indexes belong in `@linky-fit/linksync`, Nostr wire shapes in `@linky-fit/linkstr`, cashu state transitions in `@linky-fit/linkshu`
- Funds move between mints only on an explicit user action; changing the default mint moves nothing, and one payment uses one mint
- Quote ids and proofs go straight from the wallet to the mint, never through Linky infrastructure
- The recovery seed stays out of every HTTP request, and secrets stay out of every log
- Local Evolu data is cleared only by the user; quota errors are recovered by adding relay capacity. Degraded storage asks the user instead of falling back silently
- Relay URLs are WSS only; loopback WS needs `VITE_ALLOW_INSECURE_LOCALHOST_RELAYS=1` (app) or `PUSH_ALLOW_INSECURE_LOCALHOST_RELAYS=1` (push). Fetches use configured relays only, ignoring sender-controlled relay hints
- Inspector rows stay on the device in production: the sinks hold decrypted plaintext
- Env vars set only fresh-origin defaults; relay and Evolu server lists are user settings

## Conventions

- Branded ids from `@linky-fit/linksync` (`ContactId`, `MintId`, ...), never plain strings; use a library's exported types instead of redefining them
- Validate stored and wire JSON with effect `Schema` (shared pieces in `utils/schema.ts`); `nowSeconds()` and `sleep()` come from `utils/time.ts`
- New browser storage names use the `linky.` prefix. `linky_use_btc_symbol`, `linky_debug_evolu_sql`, `linky_nostr_profile_v2:`, `linky_nostr_status_v2:`, `linky_nostr_avatar_cache_v1`, `linky-push-debug-v1`, `linky-push-secrets-v1` and `linky-push-contact-names-v1` keep their names: renaming one needs a page and service-worker migration
- Sparse Evolu mutation payloads: omit empty optional fields instead of writing `null`
- Contacts, conversations, messages, reactions, identity, transactions and the cashu wallet are written only through the `@linky-fit/linksync` repositories (`app/hooks/useLinksync.ts`); app code never picks an owner id and never writes `category` or `phase`. Only `app/migrations/useLaneToShardMigration.ts` reads the legacy lane tables; its header lists the exceptions
- Translation keys are `I18nKey`, translators `Translate` (`src/i18n`); `cs.ts` is the reference locale, `en.ts`/`de.ts` `satisfies` its key set
- Plain CSS in `App.css`
- Everything in English: identifiers, comments, docs, test names and developer-facing logs. Czech is allowed only in localized UI copy (the `cs` locale), fixed wire text and test fixtures whose Czech input is the point of the test
- Comments explain unidiomatic code, briefly. A comment that restates the code or justifies an overcomplicated design means the code should be simplified instead

## Versions

App releases use CalVer `YY.M.MICRO` (`26.10.1`; the counter resets monthly), independent of the libraries.

`@linky-fit/linkshu` and `@linky-fit/linkstr` are the only npm packages; they share one SemVer version, released per `docs/npm-releases.md`. A change to an exported surface or documented behavior leaves `version` alone and states its SemVer effect in the PR description. While the version is 0.x, a breaking change to an export or documented behavior is a minor bump and anything else a patch. Every other workspace is private and its `version` field is inert.

## Local dev

- `bun run dev`: Docker stack (Nostr relay :7777, Evolu relay :4001, FakeWallet mint :3338), web app :5173, push :8787
- `bun run dev:prod`: web app on :5175 against production services
- `bun run dev:services`: the Docker stack alone, attached
- Dev inspector (debugging live app traffic): `GET /__inspector/events?cursor=0[&channel=nostr.wire]`, SSE `/__inspector/stream`, `POST /__inspector/clear` on the dev server, or tail `apps/web-app/.inspector/rows-<port>.ndjson`; viewer at `/inspector.html`

## E2E tests

```bash
docker compose -f docker-compose.dev.yml --profile e2e up -d --build --wait  # rebuild after source changes: VITE_* is inlined
cd apps/web-app && bunx playwright test --project=local-stack               # --ui to step through
```

- Production build on :5176, `trace: "on"`: every run leaves `test-results/*local-stack/trace.zip`; prefer `--ui` or the trace over `--headed`
- No slow-motion knob: a per-action delay pushes the top-up quote and offer phase timers past their deadlines
- `tests/helpers/`: `setSeedLoginStorage` for a real seed login (deterministic shards), `setRandomIdentityStorage` when "just logged in" is enough
- `window.__linkyE2E` (`src/devtools/e2e/installLinkyE2eHooks.ts`) exists only with `VITE_E2E=1`, which the compose image sets
- `tests/shards.spec.ts` must keep asserting rotation of every scope, the pointer on a second device, copy-on-write of an edited old-shard row, sends and top-ups across a rotation, and a fresh device seeing only the newest 4 message shards. Wait for final publish receipts (`status = sent`, non-pending `wrapId`) on both devices before rotating message fixtures
- Site: `bun run --filter @linky-fit/site test:e2e` (mints :3338/:3339, relay :7777, site on :5180). linkshu integration: `bun run --filter @linky-fit/linkshu test:integration` with `cashu-mint cashu-mint-target` up. linkshu CLI (`apps/linkshu-cli`, `bun run linkshu`): `bun test`, no mint, no browser/React/Evolu imports

## Gotchas

- The dev mint is not fee-free (Nutshell's default `input_fee_ppk` 100), and FakeWallet reports a quote paid on the first poll, so a top-up QR can vanish within milliseconds
- Playwright cannot intercept service-worker requests and `src/sw.ts` caches images CacheFirst: tests stubbing remote images need `serviceWorkers: "block"`
- `bunx --cwd apps/web-app playwright test` resolves wrongly; `cd apps/web-app && bunx playwright test`
- Vitest excludes `tests/**` (Playwright only); unit tests sit next to their subject under `src/`. Evolu needs the Worker polyfill in `vitest.setup.ts`
- jsdom tests of the proxy-payment handoff stub `navigator.locks` with `query`; the boot lock shim lacks it and counts as missing
- linkstr test helpers: `@linky-fit/linkstr/testing` and `@linky-fit/linkstr-react/testing`; extend them, never import them from production code
- Debug APKs install as `fit.linky.app.debug` and need that client in `google-services.json` for native push; Play bundles need release signing; Android builds need Java 17 via `apps/native-shell/scripts/with-java17.sh` (`apps/native-shell/README.md`)
- Bumping `@evolu/*`: the pins in `docker/evolu-relay/package.json` must stay protocol-compatible
