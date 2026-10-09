import { ProfileMetadata } from "@linky-fit/linkstr";
import { describe, expect, it } from "vitest";
import { applyLightningAddressToProfileMetadata } from "./profileMetadata";

describe("applyLightningAddressToProfileMetadata", () => {
  it("adds matching NIP-05 metadata for claimed linky.fit addresses", () => {
    const next = applyLightningAddressToProfileMetadata(
      new ProfileMetadata({
        displayName: "Alice",
        name: "alice",
        picture: "https://example.com/alice.png",
      }),
      "Alice42@Linky.Fit",
    );

    expect(next.lightningAddress).toBe("Alice42@Linky.Fit");
    expect(next.metadata).toEqual(
      new ProfileMetadata({
        displayName: "Alice",
        lud16: "Alice42@Linky.Fit",
        name: "alice",
        nip05: "alice42@linky.fit",
        picture: "https://example.com/alice.png",
      }),
    );
  });

  it("preserves unrelated NIP-05 identifiers for non-default addresses", () => {
    const next = applyLightningAddressToProfileMetadata(
      new ProfileMetadata({
        lud16: "old@linky.fit",
        name: "alice",
        nip05: "alice@nostr.example",
      }),
      "alice@example.com",
    );

    expect(next.metadata).toEqual(
      new ProfileMetadata({
        lud16: "alice@example.com",
        name: "alice",
        nip05: "alice@nostr.example",
      }),
    );
  });
});
