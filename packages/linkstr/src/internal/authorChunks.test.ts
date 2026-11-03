import { describe, expect, it } from "vitest";
import { REQUEST_FILTER_LIMIT, subscriptionRequests } from "./authorChunks";

describe("subscriptionRequests", () => {
  it("sends the filters of one kind together, at most REQUEST_FILTER_LIMIT per REQ", () => {
    const profiles = Array.from(
      { length: REQUEST_FILTER_LIMIT + 1 },
      (_, chunk) => ({ kinds: [0], authors: [`author-${chunk}`] }),
    );
    const statuses = [{ kinds: [30315], authors: ["author-0"] }];
    expect(subscriptionRequests([...profiles, ...statuses])).toEqual([
      profiles.slice(0, REQUEST_FILTER_LIMIT),
      profiles.slice(REQUEST_FILTER_LIMIT),
      statuses,
    ]);
  });
});
