import {
  activeNostrIdentityId,
  NonEmptyString100,
  NonEmptyString1000,
  OwnerId,
  PositiveInt,
  type NostrIdentityRow,
} from "@linky/linksync";
import { describe, expect, it } from "vitest";
import { toSyncedNostrIdentity } from "./syncedNostrIdentity";

const row = (overrides: Partial<NostrIdentityRow> = {}): NostrIdentityRow => ({
  id: activeNostrIdentityId,
  nsec: NonEmptyString1000.orThrow("nsec1abc"),
  npub: null,
  source: null,
  switchedAtSec: null,
  ownerId: OwnerId.orThrow("AAAAAAAAAAAAAAAAAAAAAA"),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  isDeleted: null,
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
          npub: NonEmptyString1000.orThrow("npub1xyz"),
          source: NonEmptyString100.orThrow("derived"),
          switchedAtSec: PositiveInt.orThrow(123),
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
