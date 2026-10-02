# LNURLw API PoC

The API runs in the existing site and web-app deployments at `/api/lnurlw`. It uses wallet-signed sessions and encrypted Nostr request/reply messages, with no database or server signing secrets. Both projects select Node 22 for native WebSocket support. There is no NFC or application-wallet integration. The included simulator acknowledges invoices without paying them.

Each project's build bundles the API and its workspace dependencies into a Node entry point. Generated API files stay out of git.

## Try a preview

From the repository, run:

```sh
bun apps/site/scripts/lnurlw-wallet.ts https://YOUR-PREVIEW.vercel.app wss://nos.lol
```

The simulator creates a throwaway key, opens its inbox, signs a two-minute session, and submits it with `POST /api/lnurlw` as `{ "session": <signed-event> }`. It prints the prepared URL and per-relay compatibility results. `GET /api/lnurlw` lists allowed relay candidates. Candidates must be explicitly supplied; the API never silently substitutes another relay. The allowlist limits server egress to hosts in the site's recommended Nostr relay list. NIP-42 and paid access are not implemented; those relays can fail the compatibility probe even when a user's normal identity can use them.

Use the printed URL while the simulator stays open:

```sh
curl "$SESSION_URL"
curl --get "$SESSION_URL" --data-urlencode "k1=$K1" --data-urlencode "pr=$INVOICE"
```

The first call returns a standard `withdrawRequest`, including `k1` and amounts in millisatoshis. Supply an unexpired BOLT11 invoice for at most 1,000 sats in the second call. `OK` means the simulated wallet acknowledged it. It does not indicate payment and no funds move. Repeating that invoice is accepted; a different invoice on the same session is rejected.

If Vercel preview protection is enabled, use an accessible preview or its protection bypass when making both simulator and terminal requests. The function allows 30 seconds; each encrypted exchange is bounded to 12 seconds. It subscribes for replies before publishing and finishes all relay work within the invocation.

## API behavior

- `GET /api/lnurlw`: API URL, candidate relay allowlist and session lifetime.
- `POST /api/lnurlw`: verify a wallet-signed session and perform a separate encrypted round trip on every supplied relay. A session URL is returned only when at least one succeeds.
- `GET /api/lnurlw?session=...`: validate the session and return LNURLw metadata.
- `GET /api/lnurlw?session=...&k1=...&pr=...`: validate the challenge, invoice and amount, then wait for the named wallet's authenticated reply. The session signature binds the API origin, relay selection, limits and expiry. A deterministic request id binds retries to the same session and invoice.

The fee cap travels in the signed session; the actual wallet must enforce it when requesting the mint's quote. Neither quote ids, proofs nor seeds pass through this API. Session URLs are bearer capabilities; do not log them. Responses disable caching and allow cross-origin browser requests, including POST preflight.

This PoC is for transport checks, not real spending. Before connecting a wallet, implement durable acceptance and payment recovery on that device, handle API timeouts as unknown outcomes, and add abuse controls for the public endpoint. The simulator's in-memory invoice binding lasts only for its process. There are no new automated tests in this PoC.
