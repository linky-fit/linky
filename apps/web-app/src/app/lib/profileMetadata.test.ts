import { ProfileMetadata } from "@linky-fit/linkstr";
import { describe, expect, it } from "vitest";
import {
  applyLightningAddressToProfileMetadata,
  dropNpubNip05,
  profileMetadataForNewKey,
} from "./profileMetadata";

const OLD_NPUB =
  "npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8";
const NEW_NPUB =
  "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m";
const OTHER_NPUB =
  "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";

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

describe("profileMetadataForNewKey", () => {
  const forNewKey = (
    fields: ConstructorParameters<typeof ProfileMetadata>[0],
  ) =>
    profileMetadataForNewKey(new ProfileMetadata(fields), OLD_NPUB, NEW_NPUB);

  it("moves the previous npub address to the new npub and drops its handle", () => {
    expect(
      forNewKey({
        name: "alice",
        lud16: `${OLD_NPUB}@linky.fit`,
        nip05: `${OLD_NPUB}@linky.fit`,
      }),
    ).toEqual(
      new ProfileMetadata({ name: "alice", lud16: `${NEW_NPUB}@linky.fit` }),
    );
  });

  it("replaces a bought name, which stays with the previous key", () => {
    expect(
      forNewKey({
        name: "alice",
        lud16: "hynek@linky.fit",
        nip05: "hynek@linky.fit",
      }),
    ).toEqual(
      new ProfileMetadata({ name: "alice", lud16: `${NEW_NPUB}@linky.fit` }),
    );
  });

  it("keeps a lightning address and handle from another domain", () => {
    const fields = {
      name: "alice",
      lud16: "alice@getalby.com",
      nip05: "alice@nostr.example",
    };
    expect(forNewKey(fields)).toEqual(new ProfileMetadata(fields));
  });

  it("drops a linky.fit handle next to a foreign address", () => {
    expect(
      forNewKey({ lud16: "alice@getalby.com", nip05: "hynek@linky.fit" }),
    ).toEqual(new ProfileMetadata({ lud16: "alice@getalby.com" }));
  });

  it("keeps another npub's linky.fit address", () => {
    expect(forNewKey({ lud16: `${OTHER_NPUB}@linky.fit` })).toEqual(
      new ProfileMetadata({ lud16: `${OTHER_NPUB}@linky.fit` }),
    );
  });
});
