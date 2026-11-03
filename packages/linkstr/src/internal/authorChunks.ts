import type { Filter } from "nostr-tools";

/**
 * Relays cap filter complexity (strfry's maxFilterTerms and similar), and an
 * oversized `authors` list is often truncated silently rather than rejected —
 * indistinguishable from the missing authors having no events. 50 is a
 * conservative common denominator, so author sets are split to never exceed it.
 */
export const AUTHOR_FILTER_LIMIT = 50;

export const chunkAuthors = <A>(authors: ReadonlyArray<A>): Array<Array<A>> => {
  const chunks: Array<Array<A>> = [];
  for (let i = 0; i < authors.length; i += AUTHOR_FILTER_LIMIT) {
    chunks.push(authors.slice(i, i + AUTHOR_FILTER_LIMIT));
  }
  return chunks;
};

/**
 * Filters per REQ. A connection holds few open subscriptions (nostr-rs-relay
 * 32, then a bare NOTICE), so one REQ carries many author chunks; ten keep
 * it near 34 KB, under the 128 KiB message cap common relays set.
 */
export const REQUEST_FILTER_LIMIT = 10;

/**
 * Groups `filters` into REQs of at most `REQUEST_FILTER_LIMIT`, never mixing
 * kinds: a relay that disallows a kind closes the whole REQ.
 */
export const subscriptionRequests = (
  filters: ReadonlyArray<Filter>,
): Array<Array<Filter>> => {
  const byKinds = new Map<string, Array<Filter>>();
  for (const filter of filters) {
    const key = JSON.stringify(filter.kinds ?? []);
    byKinds.set(key, [...(byKinds.get(key) ?? []), filter]);
  }
  return [...byKinds.values()].flatMap((group) => {
    const requests: Array<Array<Filter>> = [];
    for (let i = 0; i < group.length; i += REQUEST_FILTER_LIMIT) {
      requests.push(group.slice(i, i + REQUEST_FILTER_LIMIT));
    }
    return requests;
  });
};
