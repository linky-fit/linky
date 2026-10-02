# Linky

Mobile-first PWA for contacts, Nostr messaging and Lightning/Cashu payments, local-first on Evolu. Bun workspace: `bun` only, never npm/yarn/pnpm.

Before you commit or declare a task done, run `bun run check-code` and fix what remains until it passes. Don't run it after every edit.

## Where a rule goes

Enforce a new rule in code first: a type, a test, or an ESLint rule (shared pieces in `packages/config/eslint`). A constraint on one file is a comment beside that code. Only what neither can carry goes into the narrowest `AGENTS.md` that covers it, stated as the constraint, not its history.

## Glossary

Read `GLOSSARY.md` before discussing domain concepts. When the user uses a term listed under _Avoid_, or a term in a sense that conflicts with its definition, point it out and propose the glossary term; record newly settled terms there.

## Invariants

- Owner ids, table names and shard indexes belong in `@linky-fit/linksync`, Nostr wire shapes in `@linky-fit/linkstr`, cashu state transitions in `@linky-fit/linkshu`
- Funds move between mints only on an explicit user action; changing the default mint moves nothing, and one payment uses one mint
- Quote ids and proofs go straight from the wallet to the mint, never through Linky infrastructure
- The recovery seed stays out of every HTTP request; secrets stay out of every log
- Inspector rows hold decrypted plaintext and stay on the device in production
- Local Evolu data is cleared only by the user; quota errors are recovered by adding relay capacity, and degraded storage asks the user instead of falling back silently
- Env vars set only fresh-origin defaults; relay and Evolu server lists are user settings

## Conventions

- Emit an inspector event for every meaningful operation: user actions, relay/mint/sync/push traffic, notable state transitions
- Ids are the branded types from `@linky-fit/linksync` (`ContactId`, `TransactionId`, ...), never plain strings; use a library's exported types instead of redefining them
- Validate stored and wire JSON with effect `Schema` (shared pieces in `utils/schema.ts`); take `nowSeconds()` and `sleep()` from `utils/time.ts`
- Evolu inserts omit empty optional fields instead of writing `null`
- New browser storage names use the `linky.` prefix; existing names are frozen, because renaming one needs a page and service-worker migration
- English everywhere except localized UI copy, fixed wire text and test fixtures whose Czech input is the point of the test
- Comments explain unidiomatic code, in one line where possible. A comment that restates the code or justifies an overcomplicated design means the code should be simplified

## Package docs

`packages/*/docs/` are consumer guides for linkshu, linkstr (with linkstr-react), linksync and proxy-payment. Read the guide before using or changing a package. A change to an exported surface or documented behavior rewrites the affected guide in the same commit, so it describes only current behavior. Guides cover what to call, in which order, what it guarantees and how to recover from its errors; exported types and their doc comments are the reference, so guides leave field lists, `src/` paths and change history to the code and git.

## Versions

App releases use CalVer `YY.M.MICRO` (the counter resets monthly). Leave `version` fields alone; `@linky-fit/linkshu` and `@linky-fit/linkstr` releases follow `docs/npm-releases.md`.

## Debugging the dev app

The dev server records inspector events: `GET /__inspector/events?cursor=0[&channel=nostr.wire]`, SSE `/__inspector/stream`, `POST /__inspector/clear`, or tail `apps/web-app/.inspector/rows-<port>.ndjson`; viewer at `/inspector.html`.
