import { NonEmptyString, NonEmptyString1000, PositiveInt } from "@evolu/common";
import { describe, expect, it } from "vitest";
import { keryxSubscriptionIdFor } from "../model/ids";
import { linkyStore, runNow } from "../testing/linky";
import { makeKeryxSubscriptionsRepository } from "./keryxSubscriptions";

const origin = "https://keryx-demo.github.io";
const id = keryxSubscriptionIdFor(origin);
const trust = (snapshotVersion: number) =>
  NonEmptyString.orThrow(
    JSON.stringify({
      rootJson: "{}",
      timestampVersion: 1,
      snapshotVersion,
      metaVersions: {},
    }),
  );

const subscription = (channels: ReadonlyArray<string> = ["news"]) => ({
  id,
  origin: NonEmptyString1000.orThrow(origin),
  trustJson: trust(1),
  identityJson: NonEmptyString.orThrow(
    JSON.stringify({ companyName: "Keryx Demo" }),
  ),
  channelsJson: NonEmptyString1000.orThrow(JSON.stringify(channels)),
  pairedAtSec: PositiveInt.orThrow(1_000),
});

describe("keryx subscriptions repository", () => {
  it("keeps one row per join origin", () => {
    const { store } = linkyStore();
    const subscriptions = makeKeryxSubscriptionsRepository(store);
    runNow(subscriptions.insert(subscription()));
    runNow(subscriptions.insert(subscription(["news", "security"])));
    expect(runNow(subscriptions.all)).toMatchObject([
      { id, origin, channelsJson: '["news","security"]' },
    ]);
  });

  it("skips a row whose required columns have not synced yet", () => {
    const { db, store } = linkyStore();
    const subscriptions = makeKeryxSubscriptionsRepository(store);
    runNow(
      db.mutate([
        {
          kind: "update",
          table: "keryxSubscription",
          ownerId: store.shardOwner("keryx", 0).id,
          row: { id, origin },
        },
      ]),
    );
    expect(runNow(subscriptions.all)).toEqual([]);
  });

  it("pairs the origin again after it was removed", () => {
    const { store } = linkyStore();
    const subscriptions = makeKeryxSubscriptionsRepository(store);
    runNow(subscriptions.insert(subscription()));
    runNow(subscriptions.remove(id));
    runNow(subscriptions.insert(subscription()));
    expect(runNow(subscriptions.all)).toHaveLength(1);
  });

  it("writes refreshed trust and added private feeds with update", () => {
    const { store } = linkyStore();
    const subscriptions = makeKeryxSubscriptionsRepository(store);
    runNow(subscriptions.insert(subscription()));
    const privateFeedsJson = NonEmptyString.orThrow(
      JSON.stringify([`${origin}/feed.json`]),
    );
    runNow(subscriptions.update(id, { trustJson: trust(2), privateFeedsJson }));
    expect(runNow(subscriptions.byId(id))).toMatchObject({
      trustJson: trust(2),
      privateFeedsJson,
    });
  });
});
