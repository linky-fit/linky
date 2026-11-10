import { encodeNpub, Pubkey } from "@linky-fit/linkstr";
import {
  createId,
  NonEmptyString,
  NonEmptyString1000,
} from "@linky-fit/linksync";
import { expect, it } from "vitest";
import { hiddenListingsToMove } from "./hiddenListingsMigration";

const ALICE = Pubkey.make(
  "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245",
);
const STRANGER = Pubkey.make(
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
);

it("moves this device's hides, strangers' included, and the hides on contact rows", () => {
  const alice = createId<"Contact">();
  const bob = createId<"Contact">();
  const plain = createId<"Contact">();

  expect(
    hiddenListingsToMove(
      [
        `${ALICE}:eggs`,
        `${ALICE}:a:b`,
        `${STRANGER}:milk`,
        "eggs",
        `${ALICE}:`,
        `${ALICE}:${"x".repeat(1001)}`,
      ],
      [
        {
          id: alice,
          npub: NonEmptyString1000.orThrow(encodeNpub(ALICE)),
          hiddenListingIdsJson: NonEmptyString.orThrow('["bike"]'),
        },
        // A row whose npub has not synced yet keeps its hides for later.
        {
          id: bob,
          npub: null,
          hiddenListingIdsJson: NonEmptyString.orThrow('["lamp"]'),
        },
        { id: plain, npub: null, hiddenListingIdsJson: null },
      ],
    ),
  ).toEqual({
    moves: [
      { author: ALICE, listingId: "eggs" },
      { author: ALICE, listingId: "a:b" },
      { author: STRANGER, listingId: "milk" },
      { author: ALICE, listingId: "bike" },
    ],
    contactsToClear: [alice],
  });
});
