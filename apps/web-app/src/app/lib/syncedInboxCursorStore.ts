import { InboxCursorStore } from "@linky-fit/linkstr";
import type { Pubkey, StringStorage, UnixSeconds } from "@linky-fit/linkstr";
import type { InboxCursorsRepository } from "@linky-fit/linksync";
import { Effect, Layer } from "effect";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { getUnknownErrorMessage } from "../../utils/unknown";

/** The frozen per-identity localStorage key of the device's own cursor. */
export const localInboxCursorKey = (pubkey: Pubkey): string =>
  `linky.inbox_cursor.${pubkey}`;

// Every synced write stays in the never-rotated app owner's quota, and a
// stale synced cursor costs a restored device only a slightly longer backfill.
export const SYNCED_INBOX_CURSOR_MIN_ADVANCE_SEC = 12 * 60 * 60;

interface SyncedInboxCursorStoreParams {
  readonly pubkey: Pubkey;
  readonly storage: StringStorage;
  readonly cursors: InboxCursorsRepository;
}

/**
 * The inbox starts from the newer of this device's cursor and the synced one
 * another device wrote. Every save lands in localStorage, and in the synced
 * cursor once it moves well past it.
 */
export const syncedInboxCursorStore = ({
  pubkey,
  storage,
  cursors,
}: SyncedInboxCursorStoreParams): Layer.Layer<InboxCursorStore> =>
  Layer.effect(
    InboxCursorStore,
    Effect.gen(function* () {
      const local = yield* InboxCursorStore;

      const writeSynced = (cursor: UnixSeconds) =>
        Effect.gen(function* () {
          const synced = yield* cursors.get(pubkey);
          if (
            synced !== null &&
            cursor < synced + SYNCED_INBOX_CURSOR_MIN_ADVANCE_SEC
          )
            return;
          yield* cursors.set(pubkey, cursor);
          reportAppLog({
            tag: "inbox.syncedCursorWritten",
            summary: `Synced the inbox cursor ${cursor} (was ${synced ?? "none"})`,
            links: { pubkey },
            payload: { cursor, previous: synced },
          });
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() =>
              reportAppLog({
                tag: "inbox.syncedCursorWriteFailed",
                summary: "Writing the synced inbox cursor failed",
                links: { pubkey },
                payload: { cursor, error: getUnknownErrorMessage(error, "") },
              }),
            ),
          ),
        );

      return {
        load: Effect.gen(function* () {
          const localCursor = yield* local.load;
          const synced = yield* cursors.get(pubkey);
          const start =
            localCursor === null || (synced !== null && synced > localCursor)
              ? synced
              : localCursor;
          reportAppLog({
            tag: "inbox.cursorLoaded",
            summary: `Inbox starts from the ${start === null ? "fallback window" : start === localCursor ? "local cursor" : "synced cursor"}`,
            links: { pubkey },
            payload: { local: localCursor, synced, start },
          });
          return start;
        }),
        save: (cursor) =>
          Effect.andThen(local.save(cursor), writeSynced(cursor)),
      };
    }),
  ).pipe(
    Layer.provide(
      InboxCursorStore.fromStringStorage(storage, localInboxCursorKey(pubkey)),
    ),
  );
