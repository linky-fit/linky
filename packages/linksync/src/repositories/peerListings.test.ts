import { Pubkey } from "@linky-fit/linkstr";
import { linkyStore, runNow } from "../testing/linky";
import { peerListingsIdFor } from "../model/ids";
import { makePeerListingsRepository } from "./peerListings";

const ME = Pubkey.make(
  "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245",
);
const OTHER_ME = Pubkey.make(
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
);
const ALICE = Pubkey.make(
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
);

const record = (document: string, publishedAtSec: number) => ({
  reader: ME,
  author: ALICE,
  document,
  publishedAtSec,
});

describe("peer listings repository", () => {
  it("keeps only the newest document per author and reader", () => {
    const { store } = linkyStore();
    const repository = makePeerListingsRepository(store);
    expect(runNow(repository.record(record('{"cash":"offer"}', 100)))).toBe(
      true,
    );
    expect(runNow(repository.record(record('{"cash":"want"}', 90)))).toBe(
      false,
    );
    expect(runNow(repository.record(record('{"cash":"want"}', 100)))).toBe(
      false,
    );
    expect(runNow(repository.record(record('{"cash":null}', 120)))).toBe(true);
    expect(runNow(repository.ofReader(ME))).toEqual([
      record('{"cash":null}', 120),
    ]);
  });

  it("moves only the time of an unchanged document", () => {
    const { store } = linkyStore();
    const repository = makePeerListingsRepository(store);
    runNow(repository.record(record('{"cash":"offer"}', 100)));
    expect(runNow(repository.record(record('{"cash":"offer"}', 200)))).toBe(
      true,
    );
    const row = runNow(repository.byId(peerListingsIdFor(ME, ALICE)));
    expect(row?.publishedAtSec).toBe(200);
    expect(row?.document).toBe('{"cash":"offer"}');
  });

  it("keeps each identity's reading apart", () => {
    const { store } = linkyStore();
    const repository = makePeerListingsRepository(store);
    runNow(repository.record(record('{"cash":"offer"}', 100)));
    runNow(
      repository.record({ ...record('{"cash":"want"}', 50), reader: OTHER_ME }),
    );
    expect(runNow(repository.ofReader(OTHER_ME))).toEqual([
      { ...record('{"cash":"want"}', 50), reader: OTHER_ME },
    ]);
    expect(runNow(repository.ofReader(ME))).toHaveLength(1);
  });
});
