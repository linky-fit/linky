# apps/site

- A plain website: no manifest, no service worker, no install prompt.
- Tokens travel in the URL hash, never the query string.
- All outbound HTTP in `api/` goes through `safeFetch` (`api/_safeFetch.ts`); `/api/lnurlp` returns no CORS headers.
- `/cashu` rejects fake-Lightning test mints before fetching an invoice. Leftover token value is forwarded to the collector; only a failed forward hands it back to the user.
