import type { BridgeMessage, CardMessage } from "@linky-fit/bolt-card";

export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

/** One line per event; `BOLT_CARD_BRIDGE_DEBUG` decides whether it is printed. */
export type DebugLog = (event: string, fields?: LogFields) => void;

export const silentLog: DebugLog = () => undefined;

const formatValue = (value: string | number | boolean | null): string =>
  typeof value === "string" && !/[\s"=]/.test(value) && value !== ""
    ? value
    : JSON.stringify(value);

export const consoleDebugLog =
  (write: (line: string) => void = console.debug): DebugLog =>
  (event, fields = {}) => {
    const parts = Object.entries(fields).flatMap(([key, value]) =>
      value === undefined ? [] : [`${key}=${formatValue(value)}`],
    );
    write(["[bolt-card-bridge]", event, ...parts].join(" "));
  };

// Debug lines still land in log files, so they show only enough of each value
// to follow one tap: never k1 (it lets anyone submit an invoice), signatures,
// challenges or client IPs.

export const shortCardId = (cardId: string): string => `${cardId.slice(0, 8)}…`;

const shortHex = (value: string): string => `${value.slice(0, 6)}…`;

export const invoicePreview = (pr: string): string =>
  `${pr.slice(0, 14)}…(${pr.length})`;

export const bridgeMessageFields = (message: BridgeMessage): LogFields => {
  switch (message._tag) {
    case "challenge":
    case "ready":
      return { tag: message._tag };
    case "withdraw":
      return {
        tag: message._tag,
        p: shortHex(message.p),
        c: shortHex(message.c),
      };
    case "callback":
      return { tag: message._tag, pr: invoicePreview(message.pr) };
  }
};

export const cardMessageFields = (message: CardMessage): LogFields => {
  switch (message._tag) {
    case "auth":
      return { tag: message._tag, card: shortCardId(message.cardId) };
    case "offer":
      return {
        tag: message._tag,
        minMsat: message.minWithdrawable,
        maxMsat: message.maxWithdrawable,
        description: message.defaultDescription,
      };
    case "accepted":
      return { tag: message._tag };
    case "rejected":
      return { tag: message._tag, reason: message.reason };
  }
};
