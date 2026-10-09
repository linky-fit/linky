import {
  decodeNpub,
  ProfileFetchResult,
  ProfileMetadata,
  ProfileUpdated,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { Exit } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  checkIdentityForSwitch,
  profileForIdentitySwitch,
} from "./keySwitchProfile";

const mocks = vi.hoisted(() => ({ reportAppLog: vi.fn() }));

vi.mock("../../devtools/inspector/appLog", () => ({
  reportAppLog: mocks.reportAppLog,
}));

const OLD_NPUB =
  "npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8";
const NEW_NPUB =
  "npub1gcxzte5zlkncx26j68ez60fzkvtkm9e0vrwdcvsjakxf9mu9qewqlfnj5z";
const NEW_ADDRESS = `${NEW_NPUB}@linky.fit`;
const newPubkey = decodeNpub(NEW_NPUB);
if (!newPubkey) throw new Error("test npub must decode");

const fetched = (metadata: ProfileMetadata | null) =>
  Exit.succeed(
    new ProfileFetchResult({
      profile: metadata
        ? new ProfileUpdated({
            metadata,
            pubkey: newPubkey,
            updatedAt: UnixSeconds.make(100),
          })
        : null,
      status: null,
    }),
  );

describe("checkIdentityForSwitch", () => {
  const check = (
    profileExit: Exit.Exit<ProfileFetchResult, unknown>,
    lookupOwnedAddress: () => Promise<string | null>,
  ) =>
    checkIdentityForSwitch({
      fetchProfile: async () => profileExit,
      lookupOwnedAddress,
      npub: NEW_NPUB,
      pubkey: newPubkey,
    });

  it.each([
    ["none", fetched(null)],
    ["found", fetched(new ProfileMetadata({ name: "Bob" }))],
    ["unchecked", Exit.fail("unreachable")],
  ] as const)("reports a %s profile", async (kind, exit) => {
    const result = await check(exit, async () => null);

    expect(result.check.kind).toBe(kind);
    expect(mocks.reportAppLog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tag: "identitySwitch.profileChecked",
        links: { pubkey: newPubkey },
        payload: { boughtName: "none", profile: kind },
      }),
    );
  });

  it("uses the identity's bought name as its address", async () => {
    const result = await check(fetched(null), async () => "bob@linky.fit");
    expect(result.lightningAddress).toBe("bob@linky.fit");
  });

  it("falls back to the npub address when the name lookup fails", async () => {
    const result = await check(fetched(null), () =>
      Promise.reject(new Error("offline")),
    );
    expect(result.lightningAddress).toBe(NEW_ADDRESS);
    expect(mocks.reportAppLog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: { boughtName: "lookup-failed", profile: "none" },
      }),
    );
  });
});

describe("profileForIdentitySwitch", () => {
  const linkyProfile = new ProfileMetadata({
    name: "Alice",
    displayName: "Alice",
    picture: "https://example.com/alice.png",
    lud16: "hynek@linky.fit",
    lud06: "lnurl1old",
    nip05: "alice@old.example",
    extraFields: { website: "https://alice.example" },
  });
  const nostrProfile = new ProfileMetadata({
    name: "Bob",
    about: "Bob's bio",
    lud16: "bob@getalby.com",
    nip05: "bob@nostr.example",
    extraFields: { banner: "https://bob.example/b.png" },
  });

  it("publishes the Linky profile with the identity's own address and fields", () => {
    expect(
      profileForIdentitySwitch({
        lightningAddress: NEW_ADDRESS,
        linkyProfile,
        nostrProfile,
        source: "linky",
      }),
    ).toEqual(
      new ProfileMetadata({
        name: "Alice",
        displayName: "Alice",
        picture: "https://example.com/alice.png",
        lud16: NEW_ADDRESS,
        nip05: "bob@nostr.example",
        extraFields: { banner: "https://bob.example/b.png" },
      }),
    );
  });

  it("imports the Nostr profile but keeps the Linky address", () => {
    expect(
      profileForIdentitySwitch({
        lightningAddress: NEW_ADDRESS,
        linkyProfile,
        nostrProfile,
        source: "nostr",
      }),
    ).toEqual(
      new ProfileMetadata({
        name: "Bob",
        about: "Bob's bio",
        lud16: NEW_ADDRESS,
        nip05: "bob@nostr.example",
        extraFields: { banner: "https://bob.example/b.png" },
      }),
    );
  });

  it("uses a bought name as the address and the handle", () => {
    const profile = profileForIdentitySwitch({
      lightningAddress: "bob@linky.fit",
      linkyProfile,
      nostrProfile,
      source: "nostr",
    });
    expect(profile.lud16).toBe("bob@linky.fit");
    expect(profile.nip05).toBe("bob@linky.fit");
  });

  it("carries the Linky profile's fields to an identity without a profile", () => {
    expect(
      profileForIdentitySwitch({
        lightningAddress: NEW_ADDRESS,
        linkyProfile: new ProfileMetadata({
          name: "Alice",
          lud16: `${OLD_NPUB}@linky.fit`,
          nip05: "hynek@linky.fit",
          extraFields: { website: "https://alice.example" },
        }),
        nostrProfile: null,
        source: "linky",
      }),
    ).toEqual(
      new ProfileMetadata({
        name: "Alice",
        lud16: NEW_ADDRESS,
        extraFields: { website: "https://alice.example" },
      }),
    );
  });
});
