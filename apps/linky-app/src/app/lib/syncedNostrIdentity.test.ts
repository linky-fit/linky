import {
  activeNostrIdentityId,
  OwnerId,
  type NostrIdentityRecord,
} from "@linky-fit/linksync";
import { describe, expect, it } from "vitest";
import { toSyncedNostrIdentity } from "./syncedNostrIdentity";

const row = (
  overrides: Partial<NostrIdentityRecord> = {},
): NostrIdentityRecord => ({
  id: activeNostrIdentityId,
  nsec: "nsec1abc",
  npub: null,
  source: null,
  switchedAtSec: null,
  ownerId: OwnerId.orThrow("AAAAAAAAAAAAAAAAAAAAAA"),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("toSyncedNostrIdentity", () => {
  it("reads a row without a source as a custom identity", () => {
    expect(toSyncedNostrIdentity(row())).toEqual({
      nsec: "nsec1abc",
      npub: null,
      source: "custom",
      switchedAtSec: null,
    });
  });

  it("keeps a derived source, the npub and the switch time", () => {
    expect(
      toSyncedNostrIdentity(
        row({
          npub: "npub1xyz",
          source: "derived",
          switchedAtSec: 123,
        }),
      ),
    ).toEqual({
      nsec: "nsec1abc",
      npub: "npub1xyz",
      source: "derived",
      switchedAtSec: 123,
    });
  });

  it("rejects a row whose key has not synced yet", () => {
    expect(toSyncedNostrIdentity(row({ nsec: null }))).toBeNull();
  });
});
