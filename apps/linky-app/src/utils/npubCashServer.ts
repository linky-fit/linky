import {
  envNpubCashServerUrl,
  envNpubCashUpstreamUrl,
} from "../platform/buildEnv";

// Every identity has a `<npub>@linky.fit` address on Linky's own
// npubcash-server, so hosted info/claim/mint-sync calls go here no matter
// which `lud16` the profile currently publishes.
export const NPUB_CASH_SERVER_BASE_URL =
  envNpubCashServerUrl || "https://npub.linky.fit";

// The same npub is also payable as `<npub>@npub.cash`. Both hosts run the
// v2 API, which hands out paid mint quotes instead of tokens; the wallet
// sweeps each (`npubCashUpstreamQuotes.ts`) and mints what it finds. Null
// when the build sweeps only Linky's server (the local stack).
export const NPUB_CASH_UPSTREAM_BASE_URL: string | null =
  envNpubCashUpstreamUrl === undefined
    ? "https://npub.cash"
    : envNpubCashUpstreamUrl || null;

/** Bounds each request, so a stalled server never holds the claim poll's lock. */
export const NPUB_CASH_REQUEST_TIMEOUT_MS = 15_000;
