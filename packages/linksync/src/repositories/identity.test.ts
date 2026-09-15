import { NonEmptyString100, NonEmptyString1000 } from "@evolu/common";
import { linkyStore, runNow } from "../testing/linky";
import { makeIdentityRepository } from "./identity";

describe("identity repository", () => {
  it("mirrors the active identity in one row", () => {
    const { db, store } = linkyStore();
    const identity = makeIdentityRepository(store);
    expect(runNow(identity.current)).toBeNull();
    runNow(
      identity.set({
        nsec: NonEmptyString1000.orThrow("nsec1a"),
        source: NonEmptyString100.orThrow("derived"),
      }),
    );
    runNow(
      identity.set({
        nsec: NonEmptyString1000.orThrow("nsec1b"),
        source: NonEmptyString100.orThrow("custom"),
      }),
    );
    expect(runNow(identity.current)).toMatchObject({
      nsec: "nsec1b",
      source: "custom",
    });
    expect(runNow(db.readTable("nostrIdentity"))).toHaveLength(1);
  });
});
