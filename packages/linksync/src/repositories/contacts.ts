import { NonEmptyString, type PositiveInt } from "@evolu/common";
import { Effect, Option, Schema } from "effect";
import type { RowNotFound, ShardDbError } from "../core";
import type { ContactId } from "../model/ids";
import type { LinkyDbSchema } from "../model/schema";
import type { LinkyStore } from "../model/store";
import { makeConversationsRepository } from "./conversations";
import { tableRepository, type TableRepository } from "./tableRepository";

export interface ContactsRepository extends TableRepository<
  LinkyDbSchema["contact"]
> {
  readonly archive: (
    id: ContactId,
    atSec: PositiveInt,
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
  /** Clears the archive on the contact and on its conversation, where older app versions keep it. */
  readonly unarchive: (
    id: ContactId,
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
  /** Hides one of the contact's listings, or shows it again; a listing already in that state writes nothing. */
  readonly setListingHidden: (
    id: ContactId,
    listingId: string,
    hidden: boolean,
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
}

const HiddenListingIds = Schema.fromJsonString(Schema.Array(Schema.String));
const decodeHiddenListingIds = Schema.decodeUnknownOption(HiddenListingIds);
const encodeHiddenListingIds = Schema.encodeSync(HiddenListingIds);

/** The ids of the contact's listings the user hid; an unreadable column hides none. */
export const hiddenListingIdsOf = (contact: {
  readonly hiddenListingIdsJson?: string | null | undefined;
}): ReadonlyArray<string> =>
  Option.getOrElse(
    decodeHiddenListingIds(contact.hiddenListingIdsJson ?? "[]"),
    () => [],
  );

/** Profiles, the user's overrides, the archive state and the hidden listings. Read cursors live in `conversations`. */
export const makeContactsRepository = (
  store: LinkyStore,
): ContactsRepository => {
  const contacts = tableRepository(store, "contacts", "contact");
  const conversations = makeConversationsRepository(store);
  return {
    ...contacts,
    archive: (id, atSec) => contacts.update(id, { archivedAtSec: atSec }),
    // The conversation goes first, so nothing copies its archive back onto the unarchived contact.
    unarchive: (id) =>
      Effect.gen(function* () {
        const conversation = yield* conversations.ensureDirect(id);
        if (conversation.archivedAtSec !== null)
          yield* conversations.update(conversation.id, { archivedAtSec: null });
        yield* contacts.update(id, { archivedAtSec: null });
      }),
    setListingHidden: (id, listingId, hidden) =>
      Effect.gen(function* () {
        const contact = yield* contacts.byId(id);
        const current = contact === null ? [] : hiddenListingIdsOf(contact);
        if (current.includes(listingId) === hidden) return;
        const next = hidden
          ? [...current, listingId]
          : current.filter((candidate) => candidate !== listingId);
        yield* contacts.update(id, {
          hiddenListingIdsJson:
            next.length === 0
              ? null
              : NonEmptyString.orThrow(encodeHiddenListingIds(next)),
        });
      }),
  };
};
