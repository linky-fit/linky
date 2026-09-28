import { ProfileMetadata } from "@linky-fit/linkstr";
import { beforeEach, describe, expect, it } from "vitest";
import {
  isDisplayableProfilePictureUrl,
  loadCachedProfile,
  loadCachedStatus,
  saveCachedProfile,
  saveCachedStatus,
} from "./profileCache";

const TEST_NPUB =
  "npub180cvv07tqw7jwr9wnh4hp24w3wl74x64l0n6ms4qxp2vj8qz9c8sv96q8j";

beforeEach(() => {
  localStorage.clear();
});

describe("isDisplayableProfilePictureUrl", () => {
  it("allows http and raster data image profile pictures", () => {
    expect(isDisplayableProfilePictureUrl("https://example.com/a.jpg")).toBe(
      true,
    );
    expect(isDisplayableProfilePictureUrl("data:image/jpeg;base64,AAAA")).toBe(
      true,
    );
  });

  it("rejects non-image and svg data urls", () => {
    expect(isDisplayableProfilePictureUrl("data:text/plain;base64,AAAA")).toBe(
      false,
    );
    expect(
      isDisplayableProfilePictureUrl("data:image/svg+xml;base64,AAAA"),
    ).toBe(false);
  });
});

describe("profile cache v2", () => {
  it("round-trips metadata with the event timestamp", () => {
    const metadata = new ProfileMetadata({
      name: "alice",
      picture: "https://example.com/alice.png",
    });
    saveCachedProfile(TEST_NPUB, metadata, 1_700_000_000);

    const cached = loadCachedProfile(TEST_NPUB);
    expect(cached?.updatedAt).toBe(1_700_000_000);
    expect(cached?.metadata).toEqual(metadata);
  });

  it("returns null for missing or malformed entries", () => {
    expect(loadCachedProfile(TEST_NPUB)).toBeNull();
    localStorage.setItem(`linky_nostr_profile_v2:${TEST_NPUB}`, "{broken");
    expect(loadCachedProfile(TEST_NPUB)).toBeNull();
  });

  it("round-trips status content including the cleared state", () => {
    saveCachedStatus(TEST_NPUB, "CZK", 1_700_000_001);
    expect(loadCachedStatus(TEST_NPUB)).toEqual({
      content: "CZK",
      updatedAt: 1_700_000_001,
    });

    saveCachedStatus(TEST_NPUB, "", 1_700_000_002);
    expect(loadCachedStatus(TEST_NPUB)).toEqual({
      content: "",
      updatedAt: 1_700_000_002,
    });
  });
});
