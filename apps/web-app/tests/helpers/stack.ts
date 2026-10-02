// scripts/e2e.sh moves the stack's ports per checkout; mint URLs come from the linkshu integration helpers.
export const NOSTR_RELAY_URL = `ws://localhost:${process.env.LINKY_E2E_NOSTR_PORT ?? 7777}`;
export const EVOLU_RELAY_URL = `ws://localhost:${process.env.LINKY_E2E_EVOLU_PORT ?? 4001}`;
export const EVOLU_QUOTA_RELAY_URL = `ws://localhost:${process.env.LINKY_E2E_EVOLU_QUOTA_PORT ?? 4002}`;

export const isNostrRelay = (url: string | URL): boolean =>
  String(url).replace(/\/$/, "") === NOSTR_RELAY_URL;
