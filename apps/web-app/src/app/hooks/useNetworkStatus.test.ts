import { describe, expect, it, vi } from "vitest";

vi.mock("../../evolu", () => ({
  EVOLU_SERVER_URLS: [],
  useEvoluRelayStatuses: () => ({}),
}));

import { evoluPhase, networkStatusOf, nostrPhase } from "./useNetworkStatus";

describe("evoluPhase", () => {
  it.each([
    { relays: [], hydrated: true, phase: "unconfigured" },
    { relays: ["unreachable"], hydrated: true, phase: "unreachable" },
    {
      relays: ["connecting", "unreachable"],
      hydrated: true,
      phase: "connecting",
    },
    { relays: [undefined], hydrated: true, phase: "connecting" },
    { relays: ["synced", "syncing"], hydrated: true, phase: "syncing" },
    { relays: ["synced"], hydrated: false, phase: "syncing" },
    { relays: ["synced", "unreachable"], hydrated: true, phase: "synced" },
  ] as const)(
    "is $phase with relays $relays and hydrated $hydrated",
    ({ relays, hydrated, phase }) => {
      expect(evoluPhase(relays, hydrated)).toBe(phase);
    },
  );
});

describe("nostrPhase", () => {
  it.each([
    {
      count: 0,
      relays: "connected",
      backfilling: false,
      phase: "unconfigured",
    },
    {
      count: 2,
      relays: "disconnected",
      backfilling: false,
      phase: "unreachable",
    },
    { count: 2, relays: "checking", backfilling: true, phase: "connecting" },
    {
      count: null,
      relays: "disconnected",
      backfilling: true,
      phase: "connecting",
    },
    { count: 2, relays: "connected", backfilling: true, phase: "scanning" },
    { count: 2, relays: "connected", backfilling: false, phase: "synced" },
  ] as const)(
    "is $phase with $count $relays relays and backfilling $backfilling",
    ({ count, relays, backfilling, phase }) => {
      expect(nostrPhase(count, relays, backfilling)).toBe(phase);
    },
  );
});

describe("networkStatusOf", () => {
  it.each([
    { online: true, evolu: "synced", nostr: "synced", status: "synced" },
    { online: false, evolu: "synced", nostr: "synced", status: "offline" },
    { online: true, evolu: "syncing", nostr: "synced", status: "syncing" },
    { online: true, evolu: "synced", nostr: "scanning", status: "syncing" },
    { online: true, evolu: "unconfigured", nostr: "synced", status: "offline" },
    { online: true, evolu: "syncing", nostr: "unreachable", status: "offline" },
  ] as const)(
    "is $status with Evolu $evolu and Nostr $nostr, online $online",
    ({ online, evolu, nostr, status }) => {
      expect(networkStatusOf(online, evolu, nostr)).toBe(status);
    },
  );
});
