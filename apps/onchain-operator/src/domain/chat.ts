import {
  decodePaymentRequestPayload,
  extractTokenText,
  parseTokenText,
} from "@linky-fit/linkshu";
import type { OnchainTransferId } from "@linky-fit/domain";
import type { Pubkey } from "@linky-fit/linkstr";
import type { OperatorTransfer } from "./transfer";

/** `pending` until a relay took the operator's message; `failed` when the outbox gave it up. */
export type ChatMessageStatus = "pending" | "sent" | "failed";

export interface ChatMessage {
  readonly id: string;
  /** `in` from the user, `out` from the operator. */
  readonly direction: "in" | "out";
  readonly text: string;
  readonly createdAtSec: number;
  readonly status: ChatMessageStatus;
}

/** The operator's chat with one user. */
export interface Chat {
  readonly peer: Pubkey;
  /** Oldest first. */
  readonly messages: readonly ChatMessage[];
  /** Whether the user wrote something the operator has not opened the chat for. */
  readonly unread: boolean;
}

/** What a message carries: text, or ecash with its mint, unit and the request id it names. */
export type MessageContent =
  | { readonly _tag: "text"; readonly text: string }
  | {
      readonly _tag: "ecash";
      readonly amount: number;
      readonly mint: string | null;
      readonly unit: string | null;
      readonly requestId: string | null;
    };

export const messageContent = (text: string): MessageContent => {
  const payload = decodePaymentRequestPayload(text);
  if (payload !== null)
    return {
      _tag: "ecash",
      amount: payload.amount,
      mint: payload.mint,
      unit: payload.unit,
      requestId: payload.requestId,
    };
  const token = extractTokenText(text);
  const parsed = token === null ? null : parseTokenText(token);
  return parsed === null
    ? { _tag: "text", text }
    : {
        _tag: "ecash",
        amount: parsed.amount,
        mint: parsed.mint,
        unit: parsed.unit,
        requestId: null,
      };
};

export type TimelineItem =
  | { readonly _tag: "message"; readonly message: ChatMessage }
  | { readonly _tag: "transfer"; readonly transfer: OperatorTransfer };

/** Messages and the user's transfers, oldest first; a transfer sits where it was requested. */
export const chatTimeline = (
  messages: readonly ChatMessage[],
  transfers: readonly OperatorTransfer[],
): TimelineItem[] =>
  [
    ...messages.map((message) => ({
      atSec: message.createdAtSec,
      item: { _tag: "message", message } satisfies TimelineItem,
    })),
    ...transfers.map((transfer) => ({
      atSec: transfer.createdAtSec,
      item: { _tag: "transfer", transfer } satisfies TimelineItem,
    })),
  ]
    .sort((a, b) => a.atSec - b.atSec)
    .map(({ item }) => item);

/** An on-chain transfer message a user sent, exactly as it arrived. */
export interface ReceivedTransferMessage {
  readonly rumorId: string;
  readonly from: Pubkey;
  /** `null` when the message does not decode. */
  readonly transferId: OnchainTransferId | null;
  readonly content: string;
  readonly sentAtSec: number;
}

/** One thing a user sent, exactly as it arrived. */
export type RawLogEntry =
  | {
      readonly _tag: "chat";
      readonly id: string;
      readonly atSec: number;
      readonly text: string;
    }
  | {
      readonly _tag: "transfer";
      readonly id: string;
      readonly atSec: number;
      readonly transferId: OnchainTransferId | null;
      readonly content: string;
    };

/** Everything `peer` sent, chat messages and transfer messages alike, oldest first. */
export const rawLog = (
  peer: Pubkey,
  messages: readonly ChatMessage[],
  transferMessages: readonly ReceivedTransferMessage[],
): RawLogEntry[] =>
  [
    ...messages.flatMap((message): RawLogEntry[] =>
      message.direction === "in"
        ? [
            {
              _tag: "chat",
              id: message.id,
              atSec: message.createdAtSec,
              text: message.text,
            },
          ]
        : [],
    ),
    ...transferMessages.flatMap((message): RawLogEntry[] =>
      message.from === peer
        ? [
            {
              _tag: "transfer",
              id: message.rumorId,
              atSec: message.sentAtSec,
              transferId: message.transferId,
              content: message.content,
            },
          ]
        : [],
    ),
  ].sort((a, b) => a.atSec - b.atSec);

/** When anything last happened in the chat, for ordering the chat list. */
export const lastActivitySec = (
  chat: Chat,
  transfers: readonly OperatorTransfer[],
): number =>
  Math.max(
    chat.messages.at(-1)?.createdAtSec ?? 0,
    ...transfers.map((transfer) => transfer.createdAtSec),
  );
