# @linky-fit/linkauth

`README.md` and `docs/` ship to npm consumers: API, usage, guarantees. App policy, monorepo paths, issue numbers and change history stay out of them.

## Docs in sync

A change to the public surface (`src/index.ts`, `src/client/index.ts`, `src/server/index.ts`, `src/signer/index.ts`) or to behavior a guide describes updates the matching `docs/*.md` in the same commit. In sync means every snippet typechecks, every failure reason and error code in a table exists in `src/`, and the protocol section in `docs/README.md` matches `src/template.ts`.

## Rules

- Plain Promises and nostr-tools only: no Effect, no `node:*` imports, no dependency on linkstr or linkshu. Code under `src/` runs in browsers and edge runtimes.
- The wire format is shared with signers outside this repository. A change to the template, the kinds, the link, the domain document or the wrap breaks deployed signers and sites: add a new kind instead.
- The assertion is verified in one place, `verifyLinkauth`; `./signer` and `./client` only validate what they must to avoid showing or sending something unusable.
- Vercel compiles the site's traced `.ts` without bundling: relative imports use `.js` specifiers, and nothing reachable from `src/server` or `src/index.ts` imports DOM-only code.
- A signer trusts a site's name, key, relays and callbacks only from its domain document, fetched through `fetchDomainDocument`; links and NIP-46 pairing links never supply them.
- Verify signatures through `hasValidSignature`, never `verifyEvent` directly: it trusts a cached marker an object can carry.
- The pairing secret in a `nostrconnect://` link stays out of logs.
