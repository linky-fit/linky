import type { PositiveInt } from "@evolu/common";
import { Effect } from "effect";
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
}

/** Profiles, the user's overrides and the archive state. Read cursors live in `conversations`. */
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
  };
};
