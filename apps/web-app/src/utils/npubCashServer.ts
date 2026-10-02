// Local dev has no npub.cash-compatible server; hosted lightning-address
// flows (info/claim/mint sync) are skipped entirely when disabled.
export const isNpubCashDisabled = (): boolean =>
  import.meta.env.VITE_NPUB_CASH_DISABLED === "true";

// Every identity has a `<npub>@linky.fit` address on Linky's own
// npub.cash-compatible server, so hosted info/claim/mint-sync calls go here
// no matter which `lud16` the profile currently publishes.
export const NPUB_CASH_SERVER_BASE_URL = "https://npub.linky.fit";

// The same npub is also payable as `<npub>@npub.cash`. Upstream's v2 API
// hands out paid mint quotes instead of tokens, so the wallet sweeps it
// separately (`npubCashUpstreamQuotes.ts`) and mints what it finds.
export const NPUB_CASH_UPSTREAM_BASE_URL = "https://npub.cash";

/** Bounds each request, so a stalled server never holds the claim poll's lock. */
export const NPUB_CASH_REQUEST_TIMEOUT_MS = 15_000;
