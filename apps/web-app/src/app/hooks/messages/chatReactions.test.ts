import { describe, expect, it } from "vitest";
import type { LocalNostrReaction } from "../../types/appTypes";
import { aggregateReactions } from "./chatReactions";

const makeReaction = (
  id: string,
  overrides?: Partial<LocalNostrReaction>,
): LocalNostrReaction => ({
  id,
  messageId: "rumor-1",
  reactorPubkey: "pub-1",
  emoji: "👍",
  createdAtSec: Number(id) || 1,
  wrapId: `reaction-${id}`,
  ...overrides,
});

describe("aggregateReactions", () => {
  it("aggregates counts and own highlight", () => {
    const chips = aggregateReactions(
      [
        makeReaction("1", { emoji: "👍", reactorPubkey: "me" }),
        makeReaction("2", { emoji: "👍", reactorPubkey: "other" }),
        makeReaction("3", { emoji: "❤️", reactorPubkey: "other" }),
      ],
      "me",
    );

    expect(chips).toEqual([
      { emoji: "❤️", count: 1, reactedByMe: false },
      { emoji: "👍", count: 1, reactedByMe: true },
    ]);
  });
});
