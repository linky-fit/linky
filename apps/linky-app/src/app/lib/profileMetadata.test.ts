import { ProfileMetadata } from "@linky-fit/linkstr";
import { describe, expect, it } from "vitest";
import {
  applyLightningAddressToProfileMetadata,
  dropNpubNip05,
} from "./profileMetadata";

const OLD_NPUB =
  "npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8";

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
      applyLightningAddressToProfileMetadata(
        new ProfileMetadata({ extraFields, name: "alice" }),
        "alice@getalby.com",
      ).metadata.extraFields,
    ).toEqual(extraFields);
    expect(
      dropNpubNip05(
        new ProfileMetadata({ extraFields, nip05: `${OLD_NPUB}@linky.fit` }),
      )?.extraFields,
    ).toEqual(extraFields);
  });
});
