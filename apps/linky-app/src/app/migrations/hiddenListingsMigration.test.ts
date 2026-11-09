import { encodeNpub, Pubkey } from "@linky-fit/linkstr";
import {
  createId,
  makeContactsRepository,
  NonEmptyString1000,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { makeTestLinkyStore } from "../../testUtils/linkyStore";
import { hiddenListingsToMove } from "./hiddenListingsMigration";

const ALICE = Pubkey.make(
  "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245",
);
const STRANGER = Pubkey.make(
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
);

it("moves each hidden listing onto its author's contact and drops strangers' and malformed keys", async () => {
  const { store } = makeTestLinkyStore();
  const contacts = makeContactsRepository(store);
  const alice = createId<"Contact">();
  await Effect.runPromise(
    contacts.insert({
      id: alice,
      npub: NonEmptyString1000.orThrow(encodeNpub(ALICE)),
    }),
  );
  const rows = await Effect.runPromise(contacts.all);

  expect(
    hiddenListingsToMove(
      [
        `${ALICE}:eggs`,
        `${ALICE}:a:b`,
        `${STRANGER}:milk`,
        "eggs",
        `${ALICE}:`,
      ],
      rows,
    ),
  ).toEqual([
    { contactId: alice, listingId: "eggs" },
    { contactId: alice, listingId: "a:b" },
  ]);
});
