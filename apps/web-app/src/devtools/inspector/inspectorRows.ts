import { Option, Schema } from "effect";
import { isRecord } from "../../utils/unknown";
// Shared contract between the reporter (app side), the Vite collector
// middleware (server/inspectorCollector.ts), and the standalone inspector page
// (/inspector.html). Keep this file free of browser and Vite globals: it is
// imported from both the app bundle and the Vite node config.

export const INSPECTOR_REPORT_PATH = "/__inspector/report";
export const INSPECTOR_EVENTS_PATH = "/__inspector/events";
export const INSPECTOR_STREAM_PATH = "/__inspector/stream";
export const INSPECTOR_CLEAR_PATH = "/__inspector/clear";

export interface InspectorRow {
  /** Wall-clock ms, stamped by the reporting app. */
  at: number;
  channel: string;
  /** Event type, e.g. "reactions.react", "WirePublished", "InboxRouted". */
  tag: string;
  /** One-line human description, prebuilt by the reporter. */
  summary: string;
  /** Correlating ids grouped by domain-defined labels. */
  links: Record<string, string | string[]>;
  /** Non-correlating location and environment metadata. */
  context?: Record<string, string>;
  /** Full serialized event, shown in the detail pane. */
  payload: unknown;
}

export interface CollectedInspectorRow extends InspectorRow {
  /** Monotonic id assigned by the collector, unique per dev-server run. */
  id: number;
  /** Per-tab app instance id of the reporting tab. */
  client: string;
}

const InspectorChannel = Schema.String.pipe(
  Schema.pattern(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/),
);

export const isInspectorChannel = Schema.is(InspectorChannel);

const InspectorRowWire = Schema.Struct({
  at: Schema.Finite,
  channel: InspectorChannel,
  context: Schema.optional(Schema.Unknown),
  links: Schema.optional(Schema.Unknown),
  payload: Schema.optional(Schema.Unknown),
  summary: Schema.String,
  tag: Schema.NonEmptyString,
});
const decodeInspectorRowWire = Schema.decodeUnknownOption(InspectorRowWire);

const CollectedInspectorRowWire = Schema.Struct({
  client: Schema.String,
  id: Schema.Finite,
});
const decodeCollectedInspectorRowWire = Schema.decodeUnknownOption(
  CollectedInspectorRowWire,
);

const parseLinkValue = (value: unknown): string | string[] | null => {
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (!Array.isArray(value)) return null;
  const strings = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return strings.length > 0 ? strings : null;
};

const appendLinkValue = (
  links: Record<string, string | string[]>,
  label: string,
  value: string | string[],
): void => {
  const existing = links[label];
  if (existing === undefined) {
    links[label] = value;
    return;
  }
  links[label] = [
    ...(typeof existing === "string" ? [existing] : existing),
    ...(typeof value === "string" ? [value] : value),
  ];
};

const legacyLinkLabel = (label: string): string => {
  if (label === "wrapIds") return "wrap";
  if (label === "rumorId") return "rumor";
  if (label === "clientId") return "client";
  return label;
};

const parseInspectorRowLinks = (
  value: unknown,
): Record<string, string | string[]> => {
  if (!isRecord(value)) return {};
  const links: Record<string, string | string[]> = {};
  for (const [label, rawValue] of Object.entries(value)) {
    if (label === "relay") continue;
    const parsedValue = parseLinkValue(rawValue);
    if (parsedValue !== null) {
      appendLinkValue(links, legacyLinkLabel(label), parsedValue);
    }
  }
  return links;
};

const parseInspectorRowContext = (
  value: unknown,
  legacyLinks: unknown,
): Record<string, string> | undefined => {
  const context: Record<string, string> = {};
  if (isRecord(value)) {
    for (const [label, entry] of Object.entries(value)) {
      if (typeof entry === "string") context[label] = entry;
    }
  }
  if (
    context.relay === undefined &&
    isRecord(legacyLinks) &&
    typeof legacyLinks.relay === "string" &&
    legacyLinks.relay.length > 0
  ) {
    context.relay = legacyLinks.relay;
  }
  return Object.keys(context).length > 0 ? context : undefined;
};

export const parseInspectorRow = (value: unknown): InspectorRow | null => {
  const wire = Option.getOrNull(decodeInspectorRowWire(value));
  if (!wire) return null;
  const { at, channel, tag, summary, links, context, payload } = wire;
  const parsedContext = parseInspectorRowContext(context, links);
  return {
    at,
    channel,
    tag,
    summary,
    links: parseInspectorRowLinks(links),
    ...(parsedContext === undefined ? {} : { context: parsedContext }),
    payload,
  };
};

export const parseCollectedInspectorRow = (
  value: unknown,
): CollectedInspectorRow | null => {
  const wire = Option.getOrNull(decodeCollectedInspectorRowWire(value));
  const row = wire && parseInspectorRow(value);
  return wire && row ? { ...row, ...wire } : null;
};

export const inspectorLinkIds = (
  links: Record<string, string | string[]>,
): string[] =>
  Object.values(links).flatMap((value) =>
    typeof value === "string" ? [value] : value,
  );
