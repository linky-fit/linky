import { NonEmptyString100, NonEmptyString1000 } from "@evolu/common";
import { Pubkey, UnixSeconds } from "@linky-fit/linkstr";
import { inboxCursorSettingIdFor } from "../model/ids";
import { linkyStore, runNow } from "../testing/linky";
import { makeInboxCursorsRepository } from "./inboxCursors";

const alice = Pubkey.make("a1".repeat(32));
const bob = Pubkey.make("b0".repeat(32));

describe("inbox cursors repository", () => {
  it("keeps one setting row per identity in the app owner", () => {
    const { db, store, appOwner } = linkyStore();
    const cursors = makeInboxCursorsRepository(store);
    expect(runNow(cursors.get(alice))).toBeNull();

    runNow(cursors.set(alice, UnixSeconds.make(1_790_000_000)));
    runNow(cursors.set(alice, UnixSeconds.make(1_790_100_000)));
    runNow(cursors.set(bob, UnixSeconds.make(1_780_000_000)));

    expect(runNow(cursors.get(alice))).toBe(1_790_100_000);
    expect(runNow(cursors.get(bob))).toBe(1_780_000_000);
    const rows = runNow(db.readTable("setting"));
    expect(rows.map((row) => row.key).sort()).toEqual([
      `inboxCursor/${alice}`,
      `inboxCursor/${bob}`,
    ]);
    expect(rows.every((row) => row.ownerId === appOwner.id)).toBe(true);
  });

  it("reads a value that is not a positive whole second as absent", () => {
    const { store } = linkyStore();
    runNow(
      store.insert("meta", "setting", {
        id: inboxCursorSettingIdFor(alice),
        key: NonEmptyString100.orThrow(`inboxCursor/${alice}`),
        value: NonEmptyString1000.orThrow("soon"),
      }),
    );
    expect(runNow(makeInboxCursorsRepository(store).get(alice))).toBeNull();
  });
});
