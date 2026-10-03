import { NonEmptyString, NonEmptyString100, PositiveInt } from "@evolu/common";
import { EventId } from "@linky-fit/linkstr";
import { describe, expect, it } from "vitest";
import { supporterAwardIdFor } from "../model/ids";
import { linkyStore, runNow } from "../testing/linky";
import {
  makeSupporterAwardsRepository,
  normalizeSupporterAward,
} from "./supporterAwards";

const eventId = EventId.make("a".repeat(64));

const award = () => ({
  id: supporterAwardIdFor(eventId),
  eventJson: NonEmptyString.orThrow(JSON.stringify({ id: eventId, kind: 8 })),
  badge: NonEmptyString100.orThrow("gold"),
  awardedAtSec: PositiveInt.orThrow(1_000),
});

describe("supporter awards repository", () => {
  it("stores an award once per event in the supporter shard", () => {
    const { db, store } = linkyStore();
    const awards = makeSupporterAwardsRepository(store);
    expect(runNow(awards.insertIfAbsent(award()))).toBe(true);
    expect(runNow(awards.insertIfAbsent(award()))).toBe(false);
    expect(runNow(awards.all)).toMatchObject([
      { id: award().id, badge: "gold", awardedAtSec: 1_000 },
    ]);
    expect(runNow(db.readTable("supporterAward"))).toHaveLength(1);
  });

  it("skips an award whose columns are still arriving", () => {
    const { store } = linkyStore();
    const awards = makeSupporterAwardsRepository(store);
    runNow(awards.insert(award()));
    const [stored] = runNow(store.rows("supporter", "supporterAward"));
    expect(stored).toBeDefined();
    if (!stored) return;
    for (const column of ["eventJson", "badge", "awardedAtSec"] as const) {
      expect(normalizeSupporterAward({ ...stored, [column]: null })).toBeNull();
    }
  });
});
