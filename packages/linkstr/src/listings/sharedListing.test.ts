import { describe, expect, it } from "vitest";
import { PrivateImage } from "../chat/domain";
import { encodeNpub } from "../identity/codec";
import { makeIdentity } from "../testing";
import { Listing, ListingAmount, ListingCurrency } from "./domain";
import {
  parseSharedListingMessage,
  SHARED_LISTING_MARKER_PREFIX,
  SharedListing,
  sharedListingMessageText,
} from "./sharedListing";

const author = makeIdentity().pubkey;

const image = new PrivateImage({
  url: "https://blossom.test/abc",
  fileType: "image/jpeg",
  encryptionAlgorithm: "aes-gcm",
  key: "a".repeat(64),
  nonce: "b".repeat(24),
  encryptedSha256: "c".repeat(64),
  originalSha256: "d".repeat(64),
  encryptedSize: 1024,
  storageEncoding: "base64",
  width: 800,
  height: 600,
});

const eggs = new SharedListing({
  author,
  listing: new Listing({
    id: "eggs",
    side: "offer",
    title: "Domácí vajíčka",
    amount: ListingAmount.make("90"),
    currency: ListingCurrency.make("CZK"),
    unit: "za 10 ks",
    image,
  }),
});

const markerOf = (payload: unknown): string =>
  `${SHARED_LISTING_MARKER_PREFIX}${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;

describe("shared listing message", () => {
  it("puts the note first and the marker on the last line", () => {
    const lines = sharedListingMessageText(eggs, "  Still there? ").split("\n");

    expect(lines.slice(0, 4)).toEqual([
      "Still there?",
      "",
      "Domácí vajíčka · 90 CZK za 10 ks",
      `nostr:${encodeNpub(author)}`,
    ]);
    expect(lines[4]?.startsWith(SHARED_LISTING_MARKER_PREFIX)).toBe(true);
    expect(lines).toHaveLength(5);
  });

  it("reads back the note and the listing, image included", () => {
    const parsed = parseSharedListingMessage(
      sharedListingMessageText(eggs, "Line one\nline two"),
    );

    expect(parsed?.note).toBe("Line one\nline two");
    expect(parsed?.shared).toEqual(eggs);
  });

  it("reads a listing sent without a note", () => {
    const text = sharedListingMessageText(eggs, "");

    expect(text.split("\n")).toHaveLength(3);
    expect(parseSharedListingMessage(text)).toEqual({ note: "", shared: eggs });
  });

  it("writes sats readably", () => {
    const sats = new SharedListing({
      author,
      listing: new Listing({
        ...eggs.listing,
        amount: ListingAmount.make("5000"),
        currency: ListingCurrency.make("SAT"),
      }),
    });

    expect(sharedListingMessageText(sats, "").split("\n")[0]).toBe(
      "Domácí vajíčka · 5000 sat za 10 ks",
    );
  });

  it("keeps a multi-line title and unit on the summary line, so the note stays intact", () => {
    const multiLine = new SharedListing({
      author,
      listing: new Listing({
        ...eggs.listing,
        title: "Domácí\nvajíčka",
        unit: "za\r\n10 ks",
      }),
    });
    const text = sharedListingMessageText(multiLine, "Still there?");

    expect(text.split("\n").slice(0, 3)).toEqual([
      "Still there?",
      "",
      "Domácí vajíčka · 90 CZK za 10 ks",
    ]);
    expect(parseSharedListingMessage(text)).toEqual({
      note: "Still there?",
      shared: multiLine,
    });
  });

  it("keeps the listing when its image does not decode", () => {
    const text = [
      "Eggs",
      `nostr:${encodeNpub(author)}`,
      markerOf({
        author,
        listing: { ...eggs.listing, image: { url: "nope" } },
      }),
    ].join("\n");

    const parsed = parseSharedListingMessage(text);

    expect(parsed?.shared.listing.title).toBe("Domácí vajíčka");
    expect(parsed?.shared.listing.image).toBeUndefined();
  });

  it.each([
    ["plain text", "Hello there"],
    [
      "a marker that is not the last line",
      `${sharedListingMessageText(eggs, "")}\nP.S.`,
    ],
    [
      "a marker that does not decode",
      `Eggs\nnostr:${encodeNpub(author)}\n${SHARED_LISTING_MARKER_PREFIX}bm90IGpzb24`,
    ],
    [
      "a listing the schema refuses",
      `Eggs\nnostr:${encodeNpub(author)}\n${markerOf({ author, listing: { id: "eggs" } })}`,
    ],
    [
      "an author line naming someone else",
      sharedListingMessageText(eggs, "").replace(
        encodeNpub(author),
        encodeNpub(makeIdentity().pubkey),
      ),
    ],
    ["the marker alone", markerOf({ author, listing: eggs.listing })],
  ])("ignores %s", (_, text) => {
    expect(parseSharedListingMessage(text)).toBeNull();
  });
});
