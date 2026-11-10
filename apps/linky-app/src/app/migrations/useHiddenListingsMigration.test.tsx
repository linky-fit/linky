import { encodeNpub, Pubkey } from "@linky-fit/linkstr";
import {
  createId,
  hiddenListingKey,
  hiddenListingKeysOf,
  makeContactsRepository,
  makeHiddenListingsRepository,
  NonEmptyString,
  NonEmptyString1000,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import { act } from "react";
import { afterEach, expect, it } from "vitest";
import { makeTestLinkyStore } from "../../testUtils/linkyStore";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { LOCAL_HIDDEN_LISTINGS_KEY } from "./hiddenListingsMigration";
import { useHiddenListingsMigration } from "./useHiddenListingsMigration";

const ALICE = Pubkey.make(
  "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245",
);
const STRANGER = Pubkey.make(
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
);

afterEach(() => localStorage.clear());

it("moves the hides into the table without hiding again what another device showed", async () => {
  const { store } = makeTestLinkyStore();
  const contacts = makeContactsRepository(store);
  const hidden = makeHiddenListingsRepository(store);
  const alice = createId<"Contact">();
  await Effect.runPromise(
    contacts.insert({
      id: alice,
      npub: NonEmptyString1000.orThrow(encodeNpub(ALICE)),
      hiddenListingIdsJson: NonEmptyString.orThrow('["bike","lamp"]'),
    }),
  );
  await Effect.runPromise(hidden.setHidden(ALICE, "lamp", true));
  await Effect.runPromise(hidden.setHidden(ALICE, "lamp", false));
  localStorage.setItem(
    LOCAL_HIDDEN_LISTINGS_KEY,
    JSON.stringify([`${STRANGER}:milk`]),
  );
  const contactRows = await Effect.runPromise(contacts.all);

  const Probe = () => {
    useHiddenListingsMigration({
      contactRows,
      contactsRepository: contacts,
      hiddenListingsRepository: hidden,
      hydrated: true,
    });
    return null;
  };
  const view = await renderIntoDocument(<Probe />);
  await act(async () => {});

  expect(hiddenListingKeysOf(await Effect.runPromise(hidden.all))).toEqual(
    new Set([
      hiddenListingKey(ALICE, "bike"),
      hiddenListingKey(STRANGER, "milk"),
    ]),
  );
  expect(
    (await Effect.runPromise(contacts.byId(alice)))?.hiddenListingIdsJson,
  ).toBeNull();
  expect(localStorage.getItem(LOCAL_HIDDEN_LISTINGS_KEY)).toBeNull();
  await view.unmount();
});
