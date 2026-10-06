import { Option, Schema } from "effect";
import type { Filter } from "nostr-tools";
import { firstTagValue, tagValues } from "../internal/nostrEvent";
import type { SignedPlainEvent } from "../internal/nostrEvent";
import type { PlainEventTemplate } from "../internal/plainEvent";
import { AppDataEvent, AppDataIdentifier } from "./domain";
import type { AppDataDraft, AppDataQuery } from "./domain";

/** NIP-78 arbitrary custom app data, addressable by author and `d` tag. */
export const APP_DATA_KIND = 30078;

const decodeIdentifier = Schema.decodeUnknownOption(AppDataIdentifier);

export const encodeAppDataEvent = (
  draft: AppDataDraft,
): PlainEventTemplate => ({
  kind: APP_DATA_KIND,
  tags: [["d", draft.identifier], ...draft.tags.map((tag) => [...tag])],
  content: draft.content,
});

export const appDataFilter = (query: AppDataQuery): Filter => ({
  kinds: [APP_DATA_KIND],
  ...(query.authors === undefined ? {} : { authors: [...query.authors] }),
  ...(query.identifiers === undefined ? {} : { "#d": [...query.identifiers] }),
  ...(query.taggedPubkeys === undefined
    ? {}
    : { "#p": [...query.taggedPubkeys] }),
  ...(query.since === undefined ? {} : { since: query.since }),
});

/** Null for a verified event that is not NIP-78 or has no `d` tag. */
export const decodeAppDataEvent = (
  event: SignedPlainEvent,
): AppDataEvent | null => {
  if (event.kind !== APP_DATA_KIND) return null;
  return Option.match(decodeIdentifier(firstTagValue(event.tags, "d")), {
    onNone: () => null,
    onSome: (identifier) =>
      new AppDataEvent({
        eventId: event.id,
        author: event.pubkey,
        identifier,
        tags: event.tags,
        content: event.content,
        createdAt: event.created_at,
        event,
      }),
  });
};

/** Addressable events replace each other per author and `d` tag. */
export const slotOf = (event: AppDataEvent): string =>
  `${event.author}:${event.identifier}`;

/** Relays may answer with anything; only what the query asked for counts. */
export const matchesQuery = (
  event: AppDataEvent,
  query: AppDataQuery,
): boolean => {
  const tagged = tagValues(event.tags, "p");
  return (
    (query.authors?.includes(event.author) ?? true) &&
    (query.identifiers?.includes(event.identifier) ?? true) &&
    (query.taggedPubkeys?.some((pubkey) => tagged.includes(pubkey)) ?? true) &&
    (query.since === undefined || event.createdAt >= query.since)
  );
};
