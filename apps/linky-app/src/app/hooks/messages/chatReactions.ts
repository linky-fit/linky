import type {
  ChatReactionChip,
  LocalNostrReaction,
} from "../../types/appTypes";
import { trimString } from "../../../utils/validation";

export const aggregateReactions = (
  reactions: readonly LocalNostrReaction[],
  ownPubkey: string | null,
): ChatReactionChip[] => {
  const own = trimString(ownPubkey);

  // One reaction per user: keep only the latest reaction per reactor
  const latestByUser = new Map<string, LocalNostrReaction>();
  for (const reaction of reactions) {
    const reactor = trimString(reaction.reactorPubkey);
    if (!reactor) continue;
    const prev = latestByUser.get(reactor);
    if (!prev || reaction.createdAtSec > prev.createdAtSec) {
      latestByUser.set(reactor, reaction);
    }
  }

  const buckets = new Map<
    string,
    {
      count: number;
      reactedByMe: boolean;
    }
  >();

  for (const reaction of latestByUser.values()) {
    const emoji = trimString(reaction.emoji);
    const reactor = trimString(reaction.reactorPubkey);
    if (!emoji || !reactor) continue;

    const bucket = buckets.get(emoji) ?? {
      count: 0,
      reactedByMe: false,
    };
    bucket.count += 1;
    if (own && reactor === own) bucket.reactedByMe = true;
    buckets.set(emoji, bucket);
  }

  return [...buckets.entries()]
    .map(([emoji, value]) => ({
      emoji,
      count: value.count,
      reactedByMe: value.reactedByMe,
    }))
    .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
};
