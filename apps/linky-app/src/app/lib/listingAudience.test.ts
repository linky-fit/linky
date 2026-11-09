import {
  encodeNpub,
  Listing,
  ListingAmount,
  ListingCurrency,
  ListingsDocument,
  SharedListing,
  type Pubkey,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import type { ListingRecord } from "@linky-fit/linksync";
import {
  hiddenListingKey,
  createId,
  NonEmptyString1000,
  OwnerId,
  PositiveInt,
} from "@linky-fit/linksync";
import { describe, expect, it } from "vitest";
import {
  buildListingsDraft,
  listingAudienceColumn,
  listingAudienceOfRecord,
  listingsRecipients,
  peerListingEntries,
  type ListingSource,
} from "./listingAudience";

const record = (overrides: Partial<ListingRecord> = {}): ListingRecord => ({
  id: createId<"Listing">(),
  createdAtSec: PositiveInt.orThrow(100),
  side: "offer",
  title: "Domácí vajíčka",
  amount: "90",
  currency: "CZK",
  unit: "za 10 ks",
  description: null,
  image: null,
  priceByAgreement: null,
  audience: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  isDeleted: 0,
  ownerId: OwnerId.orThrow(createId()),
  ...overrides,
});

const me = makeIdentity().pubkey;
const bob = makeIdentity().pubkey;
const carol = makeIdentity().pubkey;
const dave = makeIdentity().pubkey;

const listing = (id: string, reach?: "network") =>
  new Listing({
    id,
    side: "offer",
    title: id,
    amount: ListingAmount.make("1"),
    currency: ListingCurrency.make("CZK"),
    unit: "ks",
    ...(reach ? { reach } : {}),
  });

const audience = (value: Parameters<typeof listingAudienceColumn>[0]) => ({
  audience: listingAudienceColumn(value),
});

const peer = (updatedAt: number, document: ListingsDocument) => ({
  updatedAt,
  document,
});

describe("listing audience column", () => {
  it("round-trips every audience and leaves the contacts' default empty", () => {
    expect(listingAudienceColumn({ kind: "contacts" })).toBeNull();
    for (const value of [
      { kind: "contacts" },
      { kind: "network" },
      { kind: "group", group: "Rodina" },
    ] as const) {
      expect(listingAudienceOfRecord(audience(value))).toEqual(value);
    }
  });

  it("reads an unknown audience as none, so the listing goes to nobody", () => {
    const unknown = NonEmptyString1000.orThrow('{"kind":"everyone"}');
    expect(listingAudienceOfRecord({ audience: unknown })).toBeNull();
    const draft = buildListingsDraft({
      records: [record({ audience: unknown })],
      cash: null,
      recipients: [{ pubkey: bob, groups: [] }],
      peerDocuments: {},
      passOn: true,
      hidden: new Set(),
    });
    expect(draft.document.listings).toEqual([]);
    expect(draft.audiences).toEqual([]);
  });
});

describe("buildListingsDraft", () => {
  it("orders the contacts' and network listings by creation, marks the network ones and drops a row the wire does not accept", () => {
    const draft = buildListingsDraft({
      records: [
        record({
          createdAtSec: PositiveInt.orThrow(200),
          title: "Med",
          ...audience({ kind: "network" }),
        }),
        record(),
        record({ amount: "1.234" }),
      ],
      cash: "want",
      recipients: [{ pubkey: bob, groups: [] }],
      peerDocuments: {},
      passOn: true,
      hidden: new Set(),
    });
    expect(draft.document.cash).toBe("want");
    expect(
      draft.document.listings.map(({ title, reach }) => [title, reach]),
    ).toEqual([
      ["Domácí vajíčka", undefined],
      ["Med", "network"],
    ]);
    expect(draft.recipients).toEqual([bob]);
  });

  it("gives a group's listings to its members only and drops a group nobody is in", () => {
    const draft = buildListingsDraft({
      records: [
        record({
          title: "Rodinné",
          ...audience({ kind: "group", group: "Rodina" }),
        }),
        record({
          title: "Prázdné",
          ...audience({ kind: "group", group: "Nikdo" }),
        }),
      ],
      cash: null,
      recipients: [
        { pubkey: bob, groups: ["Rodina"] },
        { pubkey: carol, groups: ["Práce"] },
      ],
      peerDocuments: {},
      passOn: true,
      hidden: new Set(),
    });
    expect(draft.document.listings).toEqual([]);
    expect(draft.audiences).toHaveLength(1);
    expect(draft.audiences[0]?.recipients).toEqual([bob]);
    expect(draft.audiences[0]?.listings.map(({ title }) => title)).toEqual([
      "Rodinné",
    ]);
  });

  it("passes on the recipients' own network listings, not what they pass on", () => {
    const draft = buildListingsDraft({
      records: [],
      cash: null,
      recipients: [{ pubkey: bob, groups: [] }],
      peerDocuments: {
        [bob]: peer(
          10,
          new ListingsDocument({
            listings: [listing("kolo", "network"), listing("jen-kontakty")],
            passedOn: [
              new SharedListing({ author: dave, listing: listing("dál") }),
            ],
          }),
        ),
        // Not a recipient any more, so nothing of theirs travels on.
        [carol]: peer(
          20,
          new ListingsDocument({ listings: [listing("stará", "network")] }),
        ),
      },
      passOn: true,
      hidden: new Set(),
    });
    expect(draft.document.passedOn).toEqual([
      new SharedListing({ author: bob, listing: listing("kolo", "network") }),
    ]);
  });

  it("takes the passed-on listings in turns, newest document and newest listing first, leaving out hidden ones", () => {
    const draft = buildListingsDraft({
      records: [],
      cash: null,
      recipients: [
        { pubkey: bob, groups: [] },
        { pubkey: carol, groups: [] },
      ],
      peerDocuments: {
        [bob]: peer(
          10,
          new ListingsDocument({
            listings: ["b1", "b2", "b3"].map((id) => listing(id, "network")),
          }),
        ),
        [carol]: peer(
          20,
          new ListingsDocument({
            listings: ["c1", "c2"].map((id) => listing(id, "network")),
          }),
        ),
      },
      passOn: true,
      hidden: new Set([hiddenListingKey(bob, "b2")]),
    });
    expect(draft.document.passedOn?.map(({ listing: { id } }) => id)).toEqual([
      "c2",
      "b3",
      "c1",
      "b1",
    ]);
  });

  it("passes nothing on when the user opted out", () => {
    const draft = buildListingsDraft({
      records: [],
      cash: null,
      recipients: [{ pubkey: bob, groups: [] }],
      peerDocuments: {
        [bob]: peer(
          10,
          new ListingsDocument({ listings: [listing("kolo", "network")] }),
        ),
      },
      passOn: false,
      hidden: new Set(),
    });
    expect(draft.document.passedOn).toBeUndefined();
  });
});

describe("group listings from the contact rows", () => {
  const contactRow = (
    identity: ReturnType<typeof makeIdentity>,
    groupName: string | null,
  ) => ({
    npub: NonEmptyString1000.orThrow(encodeNpub(identity.pubkey)),
    groupName:
      groupName === null ? null : NonEmptyString1000.orThrow(groupName),
    groupNamesJson: null,
    archivedAtSec: null,
  });

  it("gives the group's listings to its unblocked members only", () => {
    const author = makeIdentity();
    const member = makeIdentity();
    const outsider = makeIdentity();
    const blocked = makeIdentity();
    const recipients = listingsRecipients(
      [
        contactRow(member, "Rodina"),
        contactRow(outsider, null),
        contactRow(blocked, "Rodina"),
      ],
      [blocked.pubkey],
      author.pubkey,
    );
    const draft = buildListingsDraft({
      records: [
        record({ title: "Pro všechny" }),
        record({
          title: "Rodinné",
          ...audience({ kind: "group", group: "Rodina" }),
        }),
      ],
      cash: null,
      recipients,
      peerDocuments: {},
      passOn: true,
      hidden: new Set(),
    });
    // Linkstr's codec tests prove that an audience opens for its recipients only.
    expect(draft.recipients).toEqual([member.pubkey, outsider.pubkey].sort());
    expect(draft.document.listings.map(({ title }) => title)).toEqual([
      "Pro všechny",
    ]);
    expect(
      draft.audiences.map(({ listings, recipients: readers }) => [
        listings.map(({ title }) => title),
        readers,
      ]),
    ).toEqual([[["Rodinné"], [member.pubkey]]]);
  });
});

const source = (
  key: Pubkey,
  updatedAt: number,
  document: ListingsDocument,
): ListingSource => ({
  pubkey: key,
  name: key.slice(0, 1),
  pictureUrl: null,
  updatedAt,
  document,
});

describe("peerListingEntries", () => {
  it("lists the direct listings, then the passed-on ones with every contact they came through", () => {
    const fromDave = new SharedListing({
      author: dave,
      listing: listing("kolo"),
    });
    const bobSource = source(
      bob,
      10,
      new ListingsDocument({
        listings: [listing("med")],
        passedOn: [fromDave],
      }),
    );
    const carolSource = source(
      carol,
      20,
      new ListingsDocument({ passedOn: [fromDave] }),
    );
    const entries = peerListingEntries([bobSource, carolSource], me, new Set());
    expect(
      entries.map(({ author, listing: { id }, via }) => [
        author,
        id,
        via.map(({ pubkey: key }) => key),
      ]),
    ).toEqual([
      [bob, "med", []],
      [dave, "kolo", [carol, bob]],
    ]);
  });

  it("leaves out passed-on listings the user gets directly, owns or whose author is blocked", () => {
    const bobSource = source(
      bob,
      10,
      new ListingsDocument({
        passedOn: [
          new SharedListing({ author: carol, listing: listing("med") }),
          new SharedListing({ author: me, listing: listing("moje") }),
          new SharedListing({ author: dave, listing: listing("kolo") }),
        ],
      }),
    );
    const carolSource = source(
      carol,
      20,
      new ListingsDocument({ listings: [listing("med")] }),
    );
    const entries = peerListingEntries(
      [bobSource, carolSource],
      me,
      new Set([dave]),
    );
    expect(entries.map(({ author, via }) => [author, via.length])).toEqual([
      [carol, 0],
    ]);
  });
});
