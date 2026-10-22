import { describe, expect, it, vi } from "vitest";
import { ProfileMetadata, type Pubkey } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { createPeerProfiles, peerProfileOf } from "./peerProfiles";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("peerProfileOf", () => {
  it("prefers the display name and drops blank fields", () => {
    expect(
      peerProfileOf(
        new ProfileMetadata({
          name: "alice",
          displayName: "Alice",
          picture: " ",
        }),
      ),
    ).toEqual({ name: "Alice", picture: null });
    expect(peerProfileOf(new ProfileMetadata({ name: " bob " }))).toEqual({
      name: "bob",
      picture: null,
    });
    expect(peerProfileOf(undefined)).toEqual({ name: null, picture: null });
  });
});

describe("createPeerProfiles", () => {
  const alice = makeIdentity().pubkey;
  const bob = makeIdentity().pubkey;

  it("fetches the users requested in one tick together, once", async () => {
    const calls: (readonly Pubkey[])[] = [];
    const profiles = createPeerProfiles(async (pubkeys) => {
      calls.push(pubkeys);
      return new Map([[alice, new ProfileMetadata({ name: "Alice" })]]);
    });
    const notified = vi.fn();
    profiles.subscribe(notified);

    profiles.request(alice);
    profiles.request(bob);
    profiles.request(alice);
    await settle();
    profiles.request(alice);
    await settle();

    expect(calls).toEqual([[alice, bob]]);
    expect(notified).toHaveBeenCalledTimes(1);
    expect(profiles.get(alice)).toEqual({ name: "Alice", picture: null });
    expect(profiles.get(bob)).toEqual({ name: null, picture: null });
  });

  it("asks again after a failed fetch", async () => {
    let fail = true;
    const profiles = createPeerProfiles(async () => {
      if (fail) throw new Error("relays down");
      return new Map([[alice, new ProfileMetadata({ name: "Alice" })]]);
    });

    profiles.request(alice);
    await settle();
    expect(profiles.get(alice)).toBeUndefined();

    fail = false;
    profiles.request(alice);
    await settle();
    expect(profiles.get(alice)?.name).toBe("Alice");
  });
});
