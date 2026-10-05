import { describe, expect, it, vi } from "vitest";

vi.mock("../../evolu", () => ({
  EVOLU_SERVER_URLS: [],
  useEvoluRelayStatuses: () => ({}),
}));

import { deriveNetworkStatus } from "./useNetworkStatus";

const synced = {
  online: true,
  evoluRelays: ["synced", "unreachable"],
  hydrated: true,
  nostrRelays: "connected",
  backfilling: false,
} as const;

describe("deriveNetworkStatus", () => {
  it.each([
    { case: "every side caught up", change: {}, status: "synced" },
    {
      case: "the browser offline",
      change: { online: false },
      status: "offline",
    },
    {
      case: "no Evolu relay configured",
      change: { evoluRelays: [] },
      status: "offline",
    },
    {
      case: "every Evolu relay unreachable",
      change: { evoluRelays: ["unreachable"] },
      status: "offline",
    },
    {
      case: "an Evolu relay still connecting",
      change: { evoluRelays: ["connecting", "unreachable"] },
      status: "syncing",
    },
    {
      case: "an Evolu relay not yet opened",
      change: { evoluRelays: [undefined] },
      status: "syncing",
    },
    {
      case: "an Evolu relay with unanswered requests",
      change: { evoluRelays: ["synced", "syncing"] },
      status: "syncing",
    },
    {
      case: "the account not hydrated",
      change: { hydrated: false },
      status: "syncing",
    },
    {
      case: "no Nostr relay reachable",
      change: { nostrRelays: "disconnected" },
      status: "offline",
    },
    {
      case: "Nostr relays still connecting",
      change: { nostrRelays: "checking" },
      status: "syncing",
    },
    {
      case: "the inbox still backfilling",
      change: { backfilling: true },
      status: "syncing",
    },
    {
      case: "Nostr offline while Evolu syncs",
      change: { nostrRelays: "disconnected", hydrated: false },
      status: "offline",
    },
  ] as const)("is $status with $case", ({ change, status }) => {
    expect(deriveNetworkStatus({ ...synced, ...change })).toBe(status);
  });
});
