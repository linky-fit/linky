import { ProfileMetadata } from "@linky-fit/linkstr";
import { describe, expect, it } from "vitest";
import { isLinkyProfile } from "./linkyProfile";

describe("isLinkyProfile", () => {
  it("recognizes a Linky account by a lightning address or NIP-05 on linky.fit", () => {
    expect(
      isLinkyProfile(new ProfileMetadata({ lud16: "npub1abc@Linky.fit" })),
    ).toBe(true);
    expect(
      isLinkyProfile(
        new ProfileMetadata({
          lud16: "a@walletofsatoshi.com",
          nip05: "a@linky.fit",
        }),
      ),
    ).toBe(true);
    expect(
      isLinkyProfile(new ProfileMetadata({ nip05: "a@notlinky.fit.example" })),
    ).toBe(false);
    expect(isLinkyProfile(new ProfileMetadata({ name: "a" }))).toBe(false);
  });
});
