import { describe, expect, it } from "vitest";
import { InboxCursorStore, Pubkey, UnixSeconds } from "@linky-fit/linkstr";
import type { InboxCursorsRepository } from "@linky-fit/linksync";
import { Effect } from "effect";
import {
  localInboxCursorKey,
  SYNCED_INBOX_CURSOR_MIN_ADVANCE_SEC,
  syncedInboxCursorStore,
} from "./syncedInboxCursorStore";

const pubkey = Pubkey.make("a1".repeat(32));
const base = UnixSeconds.make(1_790_000_000);
const at = (offsetSec: number) => UnixSeconds.make(base + offsetSec);

const harness = (initial: { local?: UnixSeconds; synced?: UnixSeconds }) => {
  const storage = new Map<string, string>();
  if (initial.local !== undefined)
    storage.set(localInboxCursorKey(pubkey), String(initial.local));
  let synced: UnixSeconds | null = initial.synced ?? null;
  const syncedWrites: Array<UnixSeconds> = [];
  const cursors: InboxCursorsRepository = {
    get: () => Effect.sync(() => synced),
    set: (_pubkey, cursor) =>
      Effect.sync(() => {
        synced = cursor;
        syncedWrites.push(cursor);
      }),
  };
  const store = Effect.runSync(
    Effect.provide(
      InboxCursorStore,
      syncedInboxCursorStore({
        pubkey,
        storage: {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, value),
        },
        cursors,
      }),
    ),
  );
  return { store, storage, syncedWrites };
};

describe("syncedInboxCursorStore", () => {
  it.each([
    { local: undefined, synced: undefined, start: null },
    { local: at(0), synced: undefined, start: at(0) },
    { local: undefined, synced: at(0), start: at(0) },
    { local: at(100), synced: at(0), start: at(100) },
    { local: at(0), synced: at(100), start: at(100) },
  ])(
    "starts from the newer of local $local and synced $synced",
    ({ local, synced, start }) => {
      const { store } = harness({
        ...(local === undefined ? {} : { local }),
        ...(synced === undefined ? {} : { synced }),
      });
      expect(Effect.runSync(store.load)).toBe(start);
    },
  );

  it("keeps every save locally and writes the synced cursor once a save moves far enough past it", () => {
    const { store, storage, syncedWrites } = harness({});
    const step = SYNCED_INBOX_CURSOR_MIN_ADVANCE_SEC;

    Effect.runSync(store.save(at(0)));
    Effect.runSync(store.save(at(step - 1)));
    expect(storage.get(localInboxCursorKey(pubkey))).toBe(String(at(step - 1)));
    expect(syncedWrites).toEqual([at(0)]);

    Effect.runSync(store.save(at(step)));
    expect(syncedWrites).toEqual([at(0), at(step)]);
  });

  it("never lowers a synced cursor another device moved further", () => {
    const { store, syncedWrites } = harness({ synced: at(10 * 24 * 3600) });

    Effect.runSync(store.save(at(0)));
    expect(syncedWrites).toEqual([]);
  });
});
