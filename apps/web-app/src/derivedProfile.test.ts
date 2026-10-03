import { describe, expect, it } from "vitest";
import {
  buildLoreleiAvatarUrl,
  deriveDefaultLightningAddress,
  deriveDefaultProfile,
  omitSyntheticContactLightningAddress,
  parseDefaultLightningAddressNpub,
} from "./derivedProfile";

describe("derivedProfile lightning address defaults", () => {
  it("uses linky.fit for new default lightning addresses", () => {
    expect(deriveDefaultLightningAddress("npub1alice")).toBe(
      "npub1alice@linky.fit",
    );
    expect(deriveDefaultProfile("npub1alice").lnAddress).toBe(
      "npub1alice@linky.fit",
    );
  });

  it("extracts npub values from the default linky.fit lightning address", () => {
    expect(parseDefaultLightningAddressNpub("npub1alice@linky.fit")).toBe(
      "npub1alice",
    );
    expect(parseDefaultLightningAddressNpub("npub1alice@Linky.Fit")).toBe(
      "npub1alice",
    );
  });

  it("ignores non-default lightning-address domains", () => {
    expect(parseDefaultLightningAddressNpub("npub1alice@npub.cash")).toBeNull();
    expect(
      parseDefaultLightningAddressNpub("npub1alice@example.com"),
    ).toBeNull();
  });

  it("omits synthetic default linky.fit addresses for the same npub", () => {
    expect(
      omitSyntheticContactLightningAddress(
        "npub1alice@linky.fit",
        "npub1alice",
      ),
    ).toBe("");
    expect(
      omitSyntheticContactLightningAddress(
        "Npub1Alice@Linky.Fit",
        "npub1alice",
      ),
    ).toBe("");
  });

  it("keeps real or unrelated lightning addresses intact", () => {
    expect(
      omitSyntheticContactLightningAddress("alice@linky.fit", "npub1alice"),
    ).toBe("alice@linky.fit");
    expect(
      omitSyntheticContactLightningAddress(
        "npub1alice@example.com",
        "npub1alice",
      ),
    ).toBe("npub1alice@example.com");
  });
});

describe("derivedProfile avatar defaults", () => {
  it("builds a hosted lorelei URL with only the seed and background palette", () => {
    const seed = "avatar seed&value";
    const url = new URL(buildLoreleiAvatarUrl(seed));

    expect(url.origin).toBe("https://api.dicebear.com");
    expect(url.pathname).toBe("/9.x/lorelei/svg");
    expect([...url.searchParams.entries()]).toEqual([
      ["seed", seed],
      ["backgroundColor", "b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf"],
    ]);
  });

  it("derives the same default avatar from the same npub", () => {
    const expected = buildLoreleiAvatarUrl("npub1alice");

    expect(deriveDefaultProfile("npub1alice").pictureUrl).toBe(expected);
    expect(deriveDefaultProfile(" npub1alice ", "cs").pictureUrl).toBe(
      expected,
    );
    expect(deriveDefaultProfile("npub1alice").pictureUrl).toBe(expected);
    expect(deriveDefaultProfile("npub1bob").pictureUrl).not.toBe(expected);
  });
});
