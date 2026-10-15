import { encodeNpub } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { describe, expect, it } from "vitest";
import { buildContactIndex } from "./inboxContactIndex";

const { pubkey } = makeIdentity();
const npub = encodeNpub(pubkey);

const contact = (
  id: string,
  createdAt: string,
  archivedAtSec: number | null = null,
) => ({ id, name: "Hynek", npub, createdAt, archivedAtSec });

describe("buildContactIndex", () => {
  it("routes a sender to the active contact over archived duplicates", () => {
    const index = buildContactIndex([
      contact("c-active", "2026-10-03T00:00:00.000Z"),
      contact("a-archived", "2026-07-01T00:00:00.000Z", 1_790_000_000),
      contact("b-archived", "2026-06-01T00:00:00.000Z", 1_790_000_000),
    ]);

    expect(index.get(pubkey)?.id).toBe("c-active");
  });

  it("keeps the routed contact when a shard move reorders the duplicates", () => {
    const before = buildContactIndex([
      contact("b", "2026-10-01T00:00:00.000Z"),
      contact("a", "2026-07-01T00:00:00.000Z"),
    ]);
    const after = buildContactIndex([
      contact("a", "2026-10-04T00:00:00.000Z"),
      contact("b", "2026-10-01T00:00:00.000Z"),
    ]);

    expect(before.get(pubkey)?.id).toBe("a");
    expect(after.get(pubkey)?.id).toBe("a");
  });

  it("routes to an archived contact when it is the only one for the npub", () => {
    const index = buildContactIndex([
      contact("archived", "2026-07-01T00:00:00.000Z", 1_790_000_000),
    ]);

    expect(index.get(pubkey)?.id).toBe("archived");
  });
});
