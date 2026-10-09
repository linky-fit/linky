import {
  decodeNpub,
  EventId,
  PlainEventReceipt,
  ProfileFetchResult,
  ProfileMetadata,
  ProfileUpdated,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { Exit } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCachedProfile } from "../../profileCache";
import { carryProfileToNewKey } from "./keySwitchProfile";

const OLD_NPUB =
  "npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8";
const NEW_NPUB =
  "npub1gcxzte5zlkncx26j68ez60fzkvtkm9e0vrwdcvsjakxf9mu9qewqlfnj5z";
const newPubkey = decodeNpub(NEW_NPUB);
if (!newPubkey) throw new Error("test npub must decode");

type CarryArgs = Parameters<typeof carryProfileToNewKey>[0];

const previousMetadata = new ProfileMetadata({
  name: "Alice",
  lud16: `${OLD_NPUB}@linky.fit`,
});

const receipt = new PlainEventReceipt({
  eventId: EventId.make("e".repeat(64)),
  kind: 0,
  sentAt: UnixSeconds.make(100),
  results: [],
});

const noProfile = Exit.succeed(
  new ProfileFetchResult({ profile: null, status: null }),
);

const carry = (
  fetchExit: Awaited<ReturnType<CarryArgs["fetchProfile"]>>,
  publishExit: Awaited<ReturnType<CarryArgs["publishProfile"]>> = Exit.succeed(
    receipt,
  ),
) => {
  const publishProfile = vi.fn<CarryArgs["publishProfile"]>(
    async () => publishExit,
  );
  const result = carryProfileToNewKey({
    fetchProfile: async () => fetchExit,
    newNpub: NEW_NPUB,
    newPubkey,
    previousMetadata,
    previousNpub: OLD_NPUB,
    publishProfile,
  });
  return { publishProfile, result };
};

describe("carryProfileToNewKey", () => {
  beforeEach(() => localStorage.clear());

  it("publishes the migrated profile when the new key has none", async () => {
    const { publishProfile, result } = carry(noProfile);

    expect(await result).toBe(true);
    const migrated = new ProfileMetadata({
      name: "Alice",
      lud16: `${NEW_NPUB}@linky.fit`,
    });
    expect(publishProfile).toHaveBeenCalledWith(migrated);
    expect(loadCachedProfile(NEW_NPUB)?.metadata).toEqual(migrated);
  });

  it("keeps the new key's existing profile", async () => {
    const existing = new ProfileMetadata({ name: "Bob" });
    const { publishProfile, result } = carry(
      Exit.succeed(
        new ProfileFetchResult({
          profile: new ProfileUpdated({
            metadata: existing,
            pubkey: newPubkey,
            updatedAt: UnixSeconds.make(100),
          }),
          status: null,
        }),
      ),
    );

    expect(await result).toBe(true);
    expect(publishProfile).not.toHaveBeenCalled();
    expect(loadCachedProfile(NEW_NPUB)).toEqual({
      metadata: existing,
      updatedAt: 100,
    });
  });

  it("publishes nothing but lets the switch go on when no relay answers", async () => {
    const { publishProfile, result } = carry(Exit.fail("unreachable"));

    expect(await result).toBe(true);
    expect(publishProfile).not.toHaveBeenCalled();
    expect(loadCachedProfile(NEW_NPUB)).toBeNull();
  });

  it("fails when the publish fails", async () => {
    const { result } = carry(noProfile, Exit.fail("rejected"));

    expect(await result).toBe(false);
    expect(loadCachedProfile(NEW_NPUB)).toBeNull();
  });
});
