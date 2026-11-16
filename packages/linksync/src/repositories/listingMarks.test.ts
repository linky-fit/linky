import { Pubkey } from "@linky-fit/linkstr";
import type { Effect } from "effect";
import type { LinkyStore } from "../model/store";
import { linkyStore, runNow } from "../testing/linky";
import {
  listingKey,
  listingKeysOf,
  makeHiddenListingsRepository,
  makePinnedListingsRepository,
} from "./listingMarks";

const ALICE = Pubkey.make(
  "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245",
);
const STRANGER = Pubkey.make(
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
);

interface Marks {
  readonly all: Effect.Effect<
    ReadonlyArray<{ authorPubkey: string | null; listingId: string | null }>
  >;
  readonly set: (
    author: Pubkey,
    listingId: string,
    marked: boolean,
  ) => Effect.Effect<void, unknown>;
}

describe.each<[string, (store: LinkyStore) => Marks]>([
  [
    "hidden",
    (store) => {
      const repository = makeHiddenListingsRepository(store);
      return { all: repository.all, set: repository.setHidden };
    },
  ],
  [
    "pinned",
    (store) => {
      const repository = makePinnedListingsRepository(store);
      return { all: repository.all, set: repository.setPinned };
    },
  ],
])("%s listings repository", (_name, make) => {
  it("marks anyone's listings and unmarks them again", () => {
    const { store } = linkyStore();
    const marks = make(store);
    runNow(marks.set(ALICE, "bike", true));
    runNow(marks.set(STRANGER, "bike", true));
    runNow(marks.set(ALICE, "bike", true));
    expect(listingKeysOf(runNow(marks.all))).toEqual(
      new Set([listingKey(ALICE, "bike"), listingKey(STRANGER, "bike")]),
    );

    runNow(marks.set(ALICE, "bike", false));
    expect(listingKeysOf(runNow(marks.all))).toEqual(
      new Set([listingKey(STRANGER, "bike")]),
    );

    runNow(marks.set(ALICE, "bike", true));
    expect(runNow(marks.all)).toHaveLength(2);
  });
});
