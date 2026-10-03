import {
  loadCachedSupporterAwards,
  saveCachedSupporterAwards,
} from "../../profileCache";
import type { SupporterAwardStamp } from "./supporterPerks";

const NO_AWARDS: ReadonlyArray<SupporterAwardStamp> = [];
const awardsByNpub = new Map<string, ReadonlyArray<SupporterAwardStamp>>();
const listeners = new Set<() => void>();

/** A contact's verified supporter awards, seeded from the cache on first read. */
export const getContactSupporterAwards = (
  npub: string,
): ReadonlyArray<SupporterAwardStamp> => {
  const known = awardsByNpub.get(npub);
  if (known) return known;
  const cached = loadCachedSupporterAwards(npub)?.awards ?? NO_AWARDS;
  awardsByNpub.set(npub, cached);
  return cached;
};

export const subscribeContactSupporterAwards = (
  listener: () => void,
): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Keeps the awards of a strictly newer `SupporterBadgesUpdated`. */
export const applySupporterBadgesUpdated = (
  npub: string,
  fact: {
    readonly awards: ReadonlyArray<SupporterAwardStamp>;
    readonly updatedAt: number;
  },
): void => {
  const cached = loadCachedSupporterAwards(npub);
  if (cached && fact.updatedAt <= cached.updatedAt) return;
  const awards = fact.awards.map(({ badge, awardedAt }) => ({
    badge,
    awardedAt,
  }));
  saveCachedSupporterAwards(npub, { awards, updatedAt: fact.updatedAt });
  awardsByNpub.set(npub, awards);
  for (const listener of listeners) listener();
};
