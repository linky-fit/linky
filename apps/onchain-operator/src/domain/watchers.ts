import { decodeNpub, type Pubkey } from "@linky-fit/linkstr";
import { formatSats } from "../format";
import { transferTerms, type OperatorTransfer } from "./transfer";

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

const transferLabel = (transfer: OperatorTransfer): string =>
  `${transfer.direction === "send" ? "on-chain send" : "on-chain receive"} of ${formatSats(transfer.amount)}`;

const quote = (text: string): string => {
  const trimmed = text.trim();
  return trimmed.length > QUOTE_MAX_LENGTH
    ? `${trimmed.slice(0, QUOTE_MAX_LENGTH)}…`
    : trimmed;
};

/** The chat message watchers get; `name` is the user's profile name or short npub. */
export const watcherAlertText = (alert: WatcherAlert, name: string): string => {
  switch (alert._tag) {
    case "requested":
      return `On-chain operator: ${name} requests an ${transferLabel(alert.transfer)}. Accept or deny it in the operator console.`;
    case "payoutDue":
      return `On-chain operator: ${name}'s Cashu arrived for an ${transferLabel(alert.transfer)}. Pay ${formatSats(alert.transfer.amount)} to their payout address.`;
    case "ecashDue":
      return alert.receivedAmount < transferTerms(alert.transfer).sendAmount
        ? `On-chain operator: the deposit for ${name}'s ${transferLabel(alert.transfer)} is confirmed but short (${formatSats(alert.receivedAmount)}). Settle it in the chat.`
        : `On-chain operator: the deposit for ${name}'s ${transferLabel(alert.transfer)} is confirmed. Send them the Cashu.`;
    case "cancelledAfterFunds":
      return `On-chain operator: ${name} wants to cancel an ${transferLabel(alert.transfer)} whose funds already moved. Settle it in the chat.`;
    case "message":
      return `On-chain operator: ${name} wrote: "${quote(alert.text)}"`;
  }
};
