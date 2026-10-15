import {
  makeKeryxSubscriptionsRepository,
  NonEmptyString,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  FEED_URL,
  ORIGIN,
  refreshed,
  snapshot,
  trust,
} from "../../testUtils/keryx";
import { makeTestLinkyStore } from "../../testUtils/linkyStore";
import {
  keryxSubscriptionInsert,
  mergePrivateFeeds,
  readKeryxCompany,
  trustWriteback,
  type KeryxCompany,
} from "./keryxCompany";

const paired = (
  pairing = keryxSubscriptionInsert(snapshot(), ["news"], 1_000),
): KeryxCompany => {
  const repository = makeKeryxSubscriptionsRepository(
    makeTestLinkyStore().store,
  );
  Effect.runSync(repository.insert(pairing));
  const [record] = Effect.runSync(repository.all);
  const company = record && readKeryxCompany(record);
  if (!company) throw new Error("the pairing did not decode");
  return company;
};

describe("keryx company rows", () => {
  it("stores a pairing that decodes back into the subscription", () => {
    expect(paired().subscription).toEqual({
      origin: ORIGIN,
      trust: trust(),
      identity: { companyName: "Acme" },
      channels: ["news"],
      privateFeeds: [{ url: FEED_URL, closed: false }],
    });
  });

  it("stores only the capability URLs of private feeds", () => {
    expect(JSON.parse(paired().record.privateFeedsJson ?? "")).toEqual([
      FEED_URL,
    ]);
  });

  it("clears the private feeds of an earlier pairing when no pattern authorizes one", () => {
    const row = keryxSubscriptionInsert(
      snapshot({ privateFeeds: [{ url: FEED_URL, info: null }] }),
      [],
      1_000,
    );
    expect(row.privateFeedsJson).toBeNull();
    expect(paired(row).subscription.privateFeeds).toEqual([]);
  });

  it("skips a row whose JSON does not decode", () => {
    const { record } = paired();
    expect(
      readKeryxCompany({
        ...record,
        trustJson: NonEmptyString.orThrow('{"rootJson":1}'),
      }),
    ).toBeNull();
  });

  it("appends only private feeds it does not follow yet", () => {
    const company = paired();
    expect(mergePrivateFeeds(company, [FEED_URL])).toBeNull();
    const patch = mergePrivateFeeds(company, [FEED_URL, `${FEED_URL}?2`]);
    expect(JSON.parse(patch?.privateFeedsJson ?? "")).toEqual([
      FEED_URL,
      `${FEED_URL}?2`,
    ]);
  });

  it("writes back only trust a refresh changed, never private feeds", () => {
    const company = paired();
    expect(trustWriteback(company, refreshed())).toBeNull();
    expect(
      trustWriteback(
        company,
        refreshed({
          privateFeeds: [
            {
              state: { url: FEED_URL, version: 3, closed: true },
              status: "closed",
              problems: [],
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(trustWriteback(company, refreshed({ trust: trust(2) }))).toEqual({
      trustJson: expect.any(String),
    });
  });
});
