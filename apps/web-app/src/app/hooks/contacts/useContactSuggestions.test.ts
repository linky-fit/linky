import {
  DiscoveredProfile,
  encodeNpub,
  ProfileMetadata,
  Pubkey,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { describe, expect, it } from "vitest";
import { selectContactSuggestions } from "./useContactSuggestions";

const discovered = (
  lastActiveAt: number,
  metadata: ConstructorParameters<typeof ProfileMetadata>[0],
): DiscoveredProfile =>
  new DiscoveredProfile({
    pubkey: Pubkey.make(getPublicKey(generateSecretKey())),
    lastActiveAt: UnixSeconds.make(lastActiveAt),
    metadata: new ProfileMetadata(metadata),
  });

describe("selectContactSuggestions", () => {
  it("keeps only unknown linky-address profiles, capped at three", () => {
    const known = discovered(500, {
      name: "known",
      lud16: "known@linky.fit",
    });
    const profiles = [
      known,
      discovered(400, {
        displayName: "No Wallet",
        lud16: "elsewhere@example.com",
      }),
      discovered(300, { name: "carol", lud16: "carol@linky.fit" }),
      discovered(200, { name: "dave", lud16: "dave@linky.fit" }),
      discovered(100, { name: "erin", lud16: "erin@linky.fit" }),
      discovered(50, { name: "late", lud16: "late@linky.fit" }),
    ];

    const suggestions = selectContactSuggestions(
      profiles,
      new Set([encodeNpub(known.pubkey)]),
    );

    expect(suggestions.map((s) => s.name)).toEqual(["carol", "dave", "erin"]);
    expect(suggestions[0]).toEqual({
      displayLnAddress: "carol@linky.fit",
      lnAddress: "carol@linky.fit",
      name: "carol",
      npub: encodeNpub(profiles[2]!.pubkey),
      pictureUrl: null,
      query: "carol@linky.fit",
    });
  });

  it("keeps new users whose only address is the synthetic npub@linky.fit one", () => {
    const fresh = discovered(10, { name: "fresh" });
    const npub = encodeNpub(fresh.pubkey);
    const profile = new DiscoveredProfile({
      ...fresh,
      metadata: new ProfileMetadata({
        name: "fresh",
        lud16: `${npub}@linky.fit`,
      }),
    });

    const suggestions = selectContactSuggestions([profile], new Set());

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      displayLnAddress: `${npub}@linky.fit`,
      lnAddress: "",
      name: "fresh",
      npub,
      query: npub,
    });
  });

  it("falls back to the lightning address when the profile has no name", () => {
    const suggestions = selectContactSuggestions(
      [discovered(10, { lud16: "anon@linky.fit" })],
      new Set(),
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.name).toBe("anon@linky.fit");
  });
});
