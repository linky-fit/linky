import { ProfileMetadata } from "@linky-fit/linkstr";
import { describe, expect, it } from "vitest";
import { dropNpubNip05 } from "./profileMetadata";

const OLD_NPUB =
  "npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8";

describe("dropNpubNip05", () => {
  it("drops an npub linky.fit handle and keeps every other field", () => {
    expect(
      dropNpubNip05(
        new ProfileMetadata({
          about: "hi",
          displayName: "Alice",
          lud06: "lnurl1",
          lud16: `${OLD_NPUB}@linky.fit`,
          name: "alice",
          nip05: `${OLD_NPUB}@linky.fit`,
          picture: "https://example.com/alice.png",
        }),
      ),
    ).toEqual(
      new ProfileMetadata({
        about: "hi",
        displayName: "Alice",
        lud06: "lnurl1",
        lud16: `${OLD_NPUB}@linky.fit`,
        name: "alice",
        picture: "https://example.com/alice.png",
      }),
    );
  });

  it.each([undefined, "hynek@linky.fit", `${OLD_NPUB}@nostr.example`])(
    "leaves nip05 %s alone",
    (nip05) => {
      expect(
        dropNpubNip05(
          new ProfileMetadata(nip05 === undefined ? {} : { nip05 }),
        ),
      ).toBeNull();
    },
  );
});

describe("unmodeled fields", () => {
  const extraFields = { website: "https://alice.example", bot: false };

  it("survive every metadata derivation", () => {
    expect(
      dropNpubNip05(
        new ProfileMetadata({ extraFields, nip05: `${OLD_NPUB}@linky.fit` }),
      )?.extraFields,
    ).toEqual(extraFields);
  });
});
