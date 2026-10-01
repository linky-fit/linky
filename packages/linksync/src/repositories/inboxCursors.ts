import { UnixSeconds, type Pubkey } from "@linky-fit/linkstr";
import { Schema, type Effect } from "effect";
import type { ShardDbError } from "../core";
import { inboxCursorSettingIdFor } from "../model/ids";
import type { LinkyStore } from "../model/store";
import { readSetting, writeSetting } from "./settings";
import { tableRepository } from "./tableRepository";

export interface InboxCursorsRepository {
  readonly get: (pubkey: Pubkey) => Effect.Effect<UnixSeconds | null>;
  readonly set: (
    pubkey: Pubkey,
    cursor: UnixSeconds,
  ) => Effect.Effect<void, ShardDbError>;
}

const StoredCursor = Schema.NumberFromString.pipe(Schema.decodeTo(UnixSeconds));

/** The synced Nostr inbox cursor of each identity, as setting rows in the app owner. */
export const makeInboxCursorsRepository = (
  store: LinkyStore,
): InboxCursorsRepository => {
  const table = tableRepository(store, "meta", "setting");
  return {
    get: (pubkey) =>
      readSetting(table, inboxCursorSettingIdFor(pubkey), StoredCursor),
    set: (pubkey, cursor) =>
      writeSetting(
        table,
        inboxCursorSettingIdFor(pubkey),
        `inboxCursor/${pubkey}`,
        StoredCursor,
        cursor,
      ),
  };
};
