import {
  encodeNpub,
  Listing,
  ListingAmount,
  ListingCurrency,
  Pubkey,
  SharedListing,
} from "@linky-fit/linkstr";
import {
  createId,
  createIdFromString,
  NonEmptyString100,
  NonEmptyString1000,
  OwnerId,
  PositiveInt,
  type ListingRecord,
} from "@linky-fit/linksync";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ContactRowLike } from "../app/types/appTypes";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { ListingDetailPage } from "./ListingDetailPage";

const ME = Pubkey.make(
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
);
const PEER = Pubkey.make(
  "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245",
);
const STRANGER = makeIdentity().pubkey;
const ownId = createIdFromString<"Listing">("own-listing");
const contactId = createIdFromString<"Contact">("peer-contact");
const messageId = createId<"Message">();

const peerListing = new Listing({
  id: "eggs",
  side: "offer",
  title: "Garden eggs",
  amount: ListingAmount.make("90"),
  currency: ListingCurrency.make("CZK"),
  unit: "per 10",
});

const bike = new Listing({ ...peerListing, id: "bike", title: "Old bike" });

const ownRecord: ListingRecord = {
  id: ownId,
  createdAtSec: PositiveInt.orThrow(100),
  side: NonEmptyString100.orThrow("want"),
  title: NonEmptyString1000.orThrow("Babysitting"),
  amount: NonEmptyString100.orThrow("200"),
  currency: NonEmptyString100.orThrow("CZK"),
  unit: NonEmptyString100.orThrow("per hour"),
  priceByAgreement: null,
  description: null,
  image: null,
  audience: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  isDeleted: 0,
  ownerId: OwnerId.orThrow(createId()),
};

const state = vi.hoisted(
  (): { contacts: ContactRowLike[]; snapshot: SharedListing | null } => ({
    contacts: [],
    snapshot: null,
  }),
);
const { attachListingToChat, navigateTo, saveNpubContact, setListingHidden } =
  vi.hoisted(() => ({
    attachListingToChat: vi.fn(),
    navigateTo: vi.fn(),
    saveNpubContact: vi.fn(),
    setListingHidden: vi.fn(),
  }));

vi.mock("@linky-fit/linkstr-react", () => ({
  useAtomSuspense: () => ({ value: { setListingHidden } }),
  useAtomValue: (atom: unknown) =>
    atom === currentPubkeyAtom
      ? ME
      : atom === peerListingsAtom
        ? {
            [PEER]: {
              document: {
                listings: [peerListing],
                passedOn: [{ author: STRANGER, listing: bike }],
              },
              updatedAt: 1,
            },
          }
        : null,
}));
vi.mock("../app/state/session/session", () => ({
  currentPubkeyAtom: { id: "currentPubkey" },
}));
vi.mock("../app/state/contacts/listings", () => ({
  peerListingsAtom: { id: "peerListings" },
}));
import { currentPubkeyAtom } from "../app/state/session/session";
import { peerListingsAtom } from "../app/state/contacts/listings";

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock(),
);
vi.mock("../app/hooks/useLinksync", () => ({
  useListingRecords: () => [ownRecord],
}));
vi.mock("../app/hooks/contacts/useDisplayContacts", () => ({
  useContacts: () => state.contacts,
  useNpubMessageContactInfo: () => (npub: string) => ({
    displayName:
      state.contacts.find((contact) => contact.npub === npub)?.name ??
      "npub1short",
    pictureUrl: null,
  }),
}));
vi.mock("../app/hooks/contacts/useSaveNpubContact", () => ({
  useSaveNpubContact: () => saveNpubContact,
}));
vi.mock("../app/hooks/profile/useEffectiveProfile", () => ({
  useEffectiveProfile: () => ({
    effectiveProfileName: "Me",
    effectiveProfilePicture: null,
  }),
}));
vi.mock("../app/hooks/useSharedListing", () => ({
  useAttachListingToChat: () => attachListingToChat,
  useSharedListingOfMessage: () => state.snapshot,
}));
vi.mock("../hooks/useRouting", () => ({ navigateTo }));

afterEach(() => {
  vi.clearAllMocks();
  state.contacts = [];
  state.snapshot = null;
});

const byTestId = (container: HTMLElement, testID: string) =>
  container.querySelector<HTMLElement>(`[data-testid="${testID}"]`);

it("shows the user's own listing as theirs, with edit and nothing to hide", async () => {
  const { container, unmount } = await renderIntoDocument(
    <ListingDetailPage author={ME} listingId={ownId} messageId={null} />,
  );
  expect(container.textContent).toContain("Babysitting");
  expect(container.textContent).toContain("listingSideWant");
  expect(byTestId(container, "listing-author")?.textContent).toContain(
    "nearbyYou",
  );
  expect(byTestId(container, "listing-edit")).not.toBeNull();
  expect(byTestId(container, "listing-audience")?.textContent).toBe(
    "listingAudienceContacts",
  );
  expect(byTestId(container, "listing-reply")).toBeNull();
  expect(byTestId(container, "listing-hide")).toBeNull();
  expect(byTestId(container, "listing-description")).toBeNull();
  await act(async () => byTestId(container, "listing-edit")?.click());
  expect(navigateTo).toHaveBeenCalledWith({ route: "listingEdit", id: ownId });
  await unmount();
});

it("replies to a contact's listing in their chat", async () => {
  state.contacts = [{ id: contactId, name: "Alice", npub: encodeNpub(PEER) }];
  const { container, unmount } = await renderIntoDocument(
    <ListingDetailPage author={PEER} listingId="eggs" messageId={null} />,
  );
  expect(byTestId(container, "listing-author")?.textContent).toContain("Alice");
  expect(byTestId(container, "listing-edit")).toBeNull();
  await act(async () => byTestId(container, "listing-author")?.click());
  expect(navigateTo).toHaveBeenCalledWith({ route: "contact", id: contactId });
  await act(async () => byTestId(container, "listing-reply")?.click());
  expect(attachListingToChat).toHaveBeenCalledExactlyOnceWith(
    contactId,
    new SharedListing({ author: PEER, listing: peerListing }),
  );
  await unmount();
});

it("keeps the author of a listing from the network anonymous and asks the contact it came through", async () => {
  state.contacts = [{ id: contactId, name: "Alice", npub: encodeNpub(PEER) }];
  const { container, unmount } = await renderIntoDocument(
    <ListingDetailPage author={STRANGER} listingId="bike" messageId={null} />,
  );
  expect(container.textContent).toContain("Old bike");
  expect(byTestId(container, "listing-author")).toBeNull();
  expect(byTestId(container, "listing-add-author")).toBeNull();
  expect(byTestId(container, "listing-via-contacts")?.textContent).toContain(
    "Alice",
  );
  await act(async () => byTestId(container, "listing-ask-via")?.click());
  expect(attachListingToChat).toHaveBeenCalledExactlyOnceWith(
    contactId,
    new SharedListing({ author: STRANGER, listing: bike }),
  );
  await unmount();
});

it("shows the copy a message holds and offers to save an author who is no contact", async () => {
  const copy = new Listing({
    ...peerListing,
    title: "Eggs as discussed",
    description: "Free range.\nPick up in Brno.",
  });
  state.snapshot = new SharedListing({ author: PEER, listing: copy });
  const { container, unmount } = await renderIntoDocument(
    <ListingDetailPage author={PEER} listingId="eggs" messageId={messageId} />,
  );
  expect(container.textContent).toContain("Eggs as discussed");
  expect(byTestId(container, "listing-description")?.textContent).toBe(
    "Free range.\nPick up in Brno.",
  );
  expect(byTestId(container, "listing-author")?.textContent).toContain(
    "npub1short",
  );
  expect(byTestId(container, "listing-reply")).toBeNull();
  expect(byTestId(container, "listing-hide")).toBeNull();
  await act(async () => byTestId(container, "listing-add-author")?.click());
  expect(saveNpubContact).toHaveBeenCalledExactlyOnceWith(encodeNpub(PEER));
  await unmount();
});

it.each([
  ["another author", { author: ME, listingId: "eggs" }],
  ["another listing", { author: PEER, listingId: "milk" }],
])(
  "shows not found when the message's copy is of %s than the route names",
  async (_, route) => {
    state.snapshot = new SharedListing({ author: PEER, listing: peerListing });
    const { container, unmount } = await renderIntoDocument(
      <ListingDetailPage {...route} messageId={messageId} />,
    );
    expect(container.textContent).toContain("listingNotFound");
    await unmount();
  },
);

it("replies with the very copy the message holds", async () => {
  state.contacts = [{ id: contactId, name: "Alice", npub: encodeNpub(PEER) }];
  state.snapshot = new SharedListing({ author: PEER, listing: peerListing });
  const { container, unmount } = await renderIntoDocument(
    <ListingDetailPage author={PEER} listingId="eggs" messageId={messageId} />,
  );
  await act(async () => byTestId(container, "listing-reply")?.click());
  expect(attachListingToChat.mock.calls[0]?.[1]).toBe(state.snapshot);
  await unmount();
});

it("hides a contact's listing on the contact", async () => {
  state.contacts = [{ id: contactId, name: "Alice", npub: encodeNpub(PEER) }];
  const { container, unmount } = await renderIntoDocument(
    <ListingDetailPage author={PEER} listingId="eggs" messageId={null} />,
  );
  expect(byTestId(container, "listing-show")).toBeNull();
  await act(async () => byTestId(container, "listing-hide")?.click());
  expect(setListingHidden).toHaveBeenCalledExactlyOnceWith(
    contactId,
    "eggs",
    true,
  );
  await unmount();
});

it("shows a listing the contact row marks hidden again", async () => {
  state.contacts = [
    {
      id: contactId,
      name: "Alice",
      npub: encodeNpub(PEER),
      hiddenListingIdsJson: '["eggs"]',
    },
  ];
  const { container, unmount } = await renderIntoDocument(
    <ListingDetailPage author={PEER} listingId="eggs" messageId={null} />,
  );
  expect(byTestId(container, "listing-hide")).toBeNull();
  expect(byTestId(container, "listing-reply")).not.toBeNull();
  await act(async () => byTestId(container, "listing-show")?.click());
  expect(setListingHidden).toHaveBeenCalledExactlyOnceWith(
    contactId,
    "eggs",
    false,
  );
  await unmount();
});

it("shows nothing live when the message holds no copy", async () => {
  const { container, unmount } = await renderIntoDocument(
    <ListingDetailPage author={PEER} listingId="eggs" messageId={messageId} />,
  );
  expect(container.textContent).toContain("listingNotFound");
  expect(container.textContent).not.toContain("Garden eggs");
  await unmount();
});
