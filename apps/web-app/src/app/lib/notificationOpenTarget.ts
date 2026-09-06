import { asNonEmptyString } from "../../utils/validation";
import { normalizePubkeyHex } from "../hooks/messages/contactIdentity";
import {
  readNotificationOpenData,
  unwrapNotificationOpenValue,
} from "./notificationOpen";
import { readField } from "../../utils/unknown";

interface NotificationOpenTarget {
  outerEventId: string;
  recipientPubkey: string;
  relayHints: string[];
  senderPubkey: string | null;
}

const NOTIFICATION_OPEN_HASH_PARAM = "notificationOpen";

export const readNotificationOpenRoute = (value: unknown): string | null => {
  const source = unwrapNotificationOpenValue(value);
  if (typeof source === "string") {
    const normalized = source.trim();
    return normalized || null;
  }

  const notification = unwrapNotificationOpenValue(
    readField(source, "notification"),
  );
  const data = unwrapNotificationOpenValue(
    readField(notification, "data") ?? readField(source, "data"),
  );
  const normalized = String(
    readField(source, "route") ?? readField(data, "route") ?? "",
  ).trim();
  return normalized || null;
};

const readNotificationRelayHints = (value: unknown): string[] => {
  const source = readNotificationOpenData(value);
  if (!Array.isArray(source)) return [];

  const seen = new Set<string>();
  const relayHints: string[] = [];
  for (const entry of source) {
    const relay = String(entry ?? "").trim();
    if (
      !relay ||
      !(relay.startsWith("wss://") || relay.startsWith("ws://")) ||
      seen.has(relay)
    ) {
      continue;
    }
    seen.add(relay);
    relayHints.push(relay);
  }
  return relayHints;
};

export const readNotificationOpenTarget = (
  value: unknown,
): NotificationOpenTarget | null => {
  const source = unwrapNotificationOpenValue(value);
  if (typeof source !== "object" || source === null) return null;

  const outerEventId = String(readField(source, "outerEventId") ?? "").trim();
  const recipientPubkey = normalizePubkeyHex(
    asNonEmptyString(readField(source, "recipientPubkey")),
  );
  const relayHints = readNotificationRelayHints(
    readField(source, "relayHints"),
  );
  const senderPubkey = normalizePubkeyHex(
    asNonEmptyString(readField(source, "senderPubkey")),
  );

  if (!outerEventId || !recipientPubkey) return null;

  return { outerEventId, recipientPubkey, relayHints, senderPubkey };
};

export const consumeNotificationOpenDetailFromHash = (): string | null => {
  if (typeof window === "undefined") return null;

  const rawHash = window.location.hash;
  const queryIndex = rawHash.indexOf("?");
  if (queryIndex < 0) return null;

  const baseHash = rawHash.slice(0, queryIndex) || "#contacts";
  const params = new URLSearchParams(rawHash.slice(queryIndex + 1));
  const detail = params.get(NOTIFICATION_OPEN_HASH_PARAM);
  if (!detail) return null;

  params.delete(NOTIFICATION_OPEN_HASH_PARAM);
  const nextQuery = params.toString();
  const nextHash = nextQuery ? `${baseHash}?${nextQuery}` : baseHash;
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${nextHash}`,
  );

  return detail;
};
