import type { InspectorEvent } from "@linky-fit/linkstr";
import {
  NoRelayReachable,
  OwnReactionConfirmed,
  OwnRetractionConfirmed,
  ProfileEventDropped,
  ProfileUpdated,
  ReactionAdded,
  ReactionDraft,
  ReactionRetracted,
  RecipientNotReached,
  RetractionDraft,
  StatusUpdated,
  WrapDropped,
} from "@linky-fit/linkstr";
import { Option, Schema } from "effect";
import { nostrKindLabel } from "../nostrKindNames";
import type { InspectorRow } from "./inspectorRows";

const short = (id: string): string => id.slice(0, 8) + "…";

const decodeRawEventSummary = Schema.decodeUnknownOption(
  Schema.Struct({ id: Schema.String, kind: Schema.Number }),
);

const decodeFilterKinds = Schema.decodeUnknownOption(
  Schema.Struct({ kinds: Schema.Array(Schema.Number) }),
);

const filterKindsLabel = (filter: unknown): string =>
  Option.match(decodeFilterKinds(filter), {
    onNone: () => "events",
    onSome: ({ kinds }) => kinds.map(nostrKindLabel).join(", "),
  });

const operationSummary = (name: string, params: unknown): string => {
  if (params instanceof ReactionDraft) {
    return `react ${params.emoji} → ${short(params.to)}`;
  }
  if (params instanceof RetractionDraft) {
    return `retract ${params.reactionIds.length} reaction(s) → ${short(params.to)}`;
  }
  return name;
};

const errorTag = (error: unknown): string | null =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  typeof error._tag === "string"
    ? error._tag
    : null;

const failedOperationLinks = (error: unknown): InspectorRow["links"] =>
  error instanceof NoRelayReachable || error instanceof RecipientNotReached
    ? {
        rumor: error.rumorId,
        client: error.clientId,
        wrap: [error.selfCopy.wrapId, error.recipientCopy.wrapId],
      }
    : {};

const routedSummaryAndLinks = (
  routed: unknown,
  rumorKind: number | null,
): { summary: string; links: InspectorRow["links"] } => {
  const kindSuffix =
    rumorKind === null ? "" : ` (rumor ${nostrKindLabel(rumorKind)})`;
  if (routed instanceof ReactionAdded) {
    return {
      summary: `ReactionAdded ${routed.emoji} from ${short(routed.from)}`,
      links: { rumor: routed.reactionId },
    };
  }
  if (routed instanceof OwnReactionConfirmed) {
    return {
      summary: `OwnReactionConfirmed ${routed.emoji} (own copy)`,
      links: {
        rumor: routed.reactionId,
        ...(routed.clientId === null ? {} : { client: routed.clientId }),
      },
    };
  }
  if (routed instanceof ReactionRetracted) {
    return {
      summary: `ReactionRetracted ${routed.reactionIds.length} reaction(s) from ${short(routed.from)}`,
      links: {},
    };
  }
  if (routed instanceof OwnRetractionConfirmed) {
    return {
      summary: `OwnRetractionConfirmed ${routed.reactionIds.length} reaction(s) (own copy)`,
      links: {
        rumor: routed.retractionId,
        ...(routed.clientId === null ? {} : { client: routed.clientId }),
      },
    };
  }
  if (routed instanceof WrapDropped) {
    return { summary: `WrapDropped ${routed.reason}${kindSuffix}`, links: {} };
  }
  return { summary: `InboxRouted${kindSuffix}`, links: {} };
};

const profileWatchSummary = (routed: unknown, kind: number | null): string => {
  if (routed instanceof ProfileUpdated) {
    return `ProfileUpdated ${short(routed.pubkey)}`;
  }
  if (routed instanceof StatusUpdated) {
    return `StatusUpdated "${routed.content}" ${short(routed.pubkey)}`;
  }
  if (routed instanceof ProfileEventDropped) {
    return `ProfileEventDropped ${routed.reason}${kind === null ? "" : ` (${nostrKindLabel(kind)})`}`;
  }
  return "ProfileWatchRouted";
};

export const linkstrEventToRow = (
  event: InspectorEvent,
  at: number,
): InspectorRow => {
  switch (event._tag) {
    case "OperationSucceeded":
      return {
        at,
        channel: "nostr.operation",
        tag: event.name,
        summary: operationSummary(event.name, event.params),
        links: {
          rumor: event.rumorId,
          client: event.clientId,
          wrap:
            event.selfCopy === null
              ? [event.recipientCopy.wrapId]
              : [event.selfCopy.wrapId, event.recipientCopy.wrapId],
        },
        payload: event,
      };
    case "OperationFailed": {
      const reason = errorTag(event.error);
      return {
        at,
        channel: "nostr.operation",
        tag: event.name,
        summary: `${operationSummary(event.name, event.params)} — failed${reason === null ? "" : `: ${reason}`}`,
        links: failedOperationLinks(event.error),
        payload: event,
      };
    }
    case "WirePublished": {
      const accepted = event.results.filter((result) => result.accepted);
      return {
        at,
        channel: "nostr.wire",
        tag: event._tag,
        summary: `publish ${nostrKindLabel(1059)} ${short(event.wrapId)} → ${accepted.length}/${event.results.length} relays accepted`,
        links: { wrap: [event.wrapId] },
        payload: event,
      };
    }
    case "WireSubscribed":
      return {
        at,
        channel: "nostr.wire",
        tag: event._tag,
        summary: `subscribe ${filterKindsLabel(event.filter)} @ ${event.relay}`,
        links: {},
        context: { relay: event.relay },
        payload: event,
      };
    case "WirePlainPublished": {
      const accepted = event.results.filter((result) => result.accepted);
      return {
        at,
        channel: "nostr.wire",
        tag: event._tag,
        summary: `publish ${nostrKindLabel(event.kind)} ${short(event.eventId)} → ${accepted.length}/${event.results.length} relays accepted`,
        links: { wrap: [event.eventId] },
        payload: event,
      };
    }
    case "WireFetched": {
      const ids = event.events.flatMap((fetched) =>
        Option.match(decodeRawEventSummary(fetched), {
          onNone: () => [],
          onSome: ({ id }) => [id],
        }),
      );
      return {
        at,
        channel: "nostr.wire",
        tag: event._tag,
        summary: `fetch ${filterKindsLabel(event.filter)} ← ${event.relay}: ${event.events.length} event(s)${event.detail === null ? "" : ` — ${event.detail}`}`,
        links: ids.length === 0 ? {} : { wrap: ids },
        context: { relay: event.relay },
        payload: event,
      };
    }
    case "WireSubscriptionEnded":
      return {
        at,
        channel: "nostr.wire",
        tag: event._tag,
        summary: `subscription ended @ ${event.relay}${event.detail === null ? "" : ` — ${event.detail}`}`,
        links: {},
        context: { relay: event.relay },
        payload: event,
      };
    case "WireEventReceived":
      return {
        at,
        channel: "nostr.wire",
        tag: event._tag,
        summary: Option.match(decodeRawEventSummary(event.event), {
          onNone: () => `event ← ${event.relay}`,
          onSome: ({ id, kind }) =>
            `${nostrKindLabel(kind)} ${short(id)} ← ${event.relay}`,
        }),
        links: Option.match(decodeRawEventSummary(event.event), {
          onNone: () => ({}),
          onSome: ({ id }) => ({ wrap: [id] }),
        }),
        context: { relay: event.relay },
        payload: event,
      };
    case "InboxWrapDeduped":
      return {
        at,
        channel: "nostr.operation",
        tag: event._tag,
        summary: `gift wrap ${short(event.wrapId)} deduped (already handled)`,
        links: { wrap: [event.wrapId] },
        payload: event,
      };
    case "InboxWalkGivenUp":
      return {
        at,
        channel: "nostr.operation",
        tag: event._tag,
        summary: `inbox stops waiting for ${event.relay}'s backfill walk after ${event.failedAttempts} failed attempts`,
        links: {},
        context: { relay: event.relay },
        payload: event,
      };
    case "InboxEventUnconfirmed":
      return {
        at,
        channel: "nostr.operation",
        tag: event._tag,
        summary: `${event.eventTag} left unconfirmed (${event.delivery}): ${event.error}`,
        links: event.wrapId === null ? {} : { wrap: [event.wrapId] },
        payload: event,
      };
    case "InboxRouted": {
      const { links, summary } = routedSummaryAndLinks(
        event.event,
        event.rumorKind,
      );
      return {
        at,
        channel: "nostr.operation",
        tag: event._tag,
        summary,
        links: {
          ...links,
          ...(event.wrapId === null ? {} : { wrap: [event.wrapId] }),
        },
        payload: event,
      };
    }
    case "PlainOperationSucceeded":
      return {
        at,
        channel: "nostr.operation",
        tag: event.name,
        summary: event.name,
        links: event.eventIds.length === 0 ? {} : { wrap: [...event.eventIds] },
        payload: event,
      };
    case "ProfileWatchRouted":
      return {
        at,
        channel: "nostr.operation",
        tag: event._tag,
        summary: profileWatchSummary(event.event, event.kind),
        links: event.eventId === null ? {} : { wrap: [event.eventId] },
        payload: event,
      };
  }
};
