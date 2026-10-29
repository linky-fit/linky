import { decodeNpub, type Pubkey } from "@linky-fit/linkstr";
import { formatSats } from "../format";
import {
  isAnyAmountReceive,
  transferTerms,
  type OperatorTransfer,
} from "./transfer";

export const MAX_WATCHERS = 10;
const QUOTE_MAX_LENGTH = 200;

/** Something that waits for the operator, which the watchers hear about in Linky. */
export type WatcherAlert =
  | { readonly _tag: "requested"; readonly transfer: OperatorTransfer }
  | { readonly _tag: "payoutDue"; readonly transfer: OperatorTransfer }
  | {
      readonly _tag: "ecashDue";
      readonly transfer: OperatorTransfer;
      readonly receivedAmount: number;
    }
  | {
      readonly _tag: "cancelledAfterFunds";
      readonly transfer: OperatorTransfer;
    }
  | {
      readonly _tag: "message";
      readonly from: Pubkey;
      readonly text: string;
    };

/** npubs separated by commas, spaces or line breaks; `null` when one does not decode or there are too many. */
export const parseWatchers = (text: string): readonly Pubkey[] | null => {
  const pubkeys = text
    .split(/[\s,;]+/u)
    .filter((part) => part !== "")
    .map(decodeNpub);
  const unique = [...new Set(pubkeys)];
  return unique.some((pubkey) => pubkey === null) ||
    unique.length > MAX_WATCHERS
    ? null
    : unique.filter((pubkey) => pubkey !== null);
};

/** "send 100 000 sat onchain", or "receive onchain" while a receive of any amount has no deposit yet. */
const transferLabel = (transfer: OperatorTransfer): string => {
  const verb = transfer.direction === "send" ? "send" : "receive";
  return isAnyAmountReceive(transfer) && transfer.update === null
    ? `${verb} onchain`
    : `${verb} ${formatSats(transferTerms(transfer).amount)} onchain`;
};

const quote = (text: string): string => {
  const trimmed = text.trim();
  return trimmed.length > QUOTE_MAX_LENGTH
    ? `${trimmed.slice(0, QUOTE_MAX_LENGTH)}…`
    : trimmed;
};

/** The chat message watchers get; `npub` is the user's whole npub, so the watcher can find them. */
export const watcherAlertText = (alert: WatcherAlert, npub: string): string => {
  switch (alert._tag) {
    case "requested":
      return `${npub} wants to ${transferLabel(alert.transfer)}`;
    case "payoutDue":
      return `${npub} paid to ${transferLabel(alert.transfer)}. Pay their address.`;
    case "ecashDue":
      return alert.receivedAmount < transferTerms(alert.transfer).sendAmount
        ? `${npub} deposited ${formatSats(alert.receivedAmount)} to ${transferLabel(alert.transfer)}, less than the ${formatSats(transferTerms(alert.transfer).sendAmount)} due. Settle it in the chat.`
        : `${npub} deposited to ${transferLabel(alert.transfer)}. Send them the Cashu.`;
    case "cancelledAfterFunds":
      return `${npub} no longer wants to ${transferLabel(alert.transfer)}, but the funds moved. Settle it in the chat.`;
    case "message":
      return `${npub} wrote: "${quote(alert.text)}"`;
  }
};
