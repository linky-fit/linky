import { Pubkey } from "@linky-fit/linkstr";
import { linkyStore, runNow } from "../testing/linky";
import {
  hiddenListingKey,
  hiddenListingKeysOf,
  makeHiddenListingsRepository,
} from "./hiddenListings";

const ALICE = Pubkey.make(
  "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245",
);
const STRANGER = Pubkey.make(
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
);

describe("hidden listings repository", () => {
  it("hides anyone's listings and shows them again", () => {
    const { store } = linkyStore();
    const hidden = makeHiddenListingsRepository(store);
    runNow(hidden.setHidden(ALICE, "bike", true));
    runNow(hidden.setHidden(STRANGER, "bike", true));
    runNow(hidden.setHidden(ALICE, "bike", true));
    expect(hiddenListingKeysOf(runNow(hidden.all))).toEqual(
      new Set([
        hiddenListingKey(ALICE, "bike"),
        hiddenListingKey(STRANGER, "bike"),
      ]),
    );

    runNow(hidden.setHidden(ALICE, "bike", false));
    expect(hiddenListingKeysOf(runNow(hidden.all))).toEqual(
      new Set([hiddenListingKey(STRANGER, "bike")]),
    );

    runNow(hidden.setHidden(ALICE, "bike", true));
    expect(runNow(hidden.all)).toHaveLength(2);
  });
});
