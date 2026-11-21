import { linkyStore, runNow } from "../testing/linky";
import { makeIdentityRepository } from "./identity";

describe("identity repository", () => {
  it("mirrors the active identity in one row", () => {
    const { db, store } = linkyStore();
    const identity = makeIdentityRepository(store);
    expect(runNow(identity.current)).toBeNull();
    runNow(
      identity.set({
        nsec: "nsec1a",
        source: "derived",
      }),
    );
    runNow(
      identity.set({
        nsec: "nsec1b",
        source: "custom",
      }),
    );
    expect(runNow(identity.current)).toMatchObject({
      nsec: "nsec1b",
      source: "custom",
    });
    expect(runNow(db.readTable("nostrIdentity"))).toHaveLength(1);
  });
});
