import type { Event, Filter } from "nostr-tools";
import type { LinkauthQueryPool } from "../server/index.js";

const hasTag = (event: Event, name: string, wanted: string[] | undefined) =>
  wanted === undefined ||
  event.tags.some(
    ([tag, value]) =>
      tag === name && value !== undefined && wanted.includes(value),
  );

/** Relay stand-in that answers `querySync` from stored events, newest first, honoring kinds, `#p`, `#x`, `since`, `until` and `limit`. */
export class FakeQueryPool implements LinkauthQueryPool {
  readonly events: Event[] = [];
  readonly queries: { relays: string[]; filter: Filter }[] = [];

  querySync(relays: string[], filter: Filter): Promise<Event[]> {
    this.queries.push({ relays, filter });
    const matching = this.events
      .filter(
        (event) =>
          (filter.kinds?.includes(event.kind) ?? true) &&
          event.created_at >= (filter.since ?? 0) &&
          event.created_at <= (filter.until ?? Infinity) &&
          hasTag(event, "p", filter["#p"]) &&
          hasTag(event, "x", filter["#x"]),
      )
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, filter.limit);
    return Promise.resolve(matching);
  }
}
