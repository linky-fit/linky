import type { OperatorTransferStatus } from "@linky-fit/onchain-transfer";
import { copy } from "../copy/en";
import { messageContent } from "../domain/chat";
import { isTransferEcash } from "../domain/rules";
import {
  isAmountUnknown,
  transferStatus,
  transferTerms,
  type OperatorTransfer,
} from "../domain/transfer";
import { formatSats } from "../format";

export type StatusKey =
  | OperatorTransferStatus
  | "requested"
  | "closedCompleted"
  | "closedCancelled";

/** The status as the operator reads it: how they closed it by hand, or the protocol's; a request nobody answered yet waits for them. */
export const statusKey = (transfer: OperatorTransfer): StatusKey =>
  transfer.closedByHand === "completed"
    ? "closedCompleted"
    : transfer.closedByHand === "cancelled"
      ? "closedCancelled"
      : (transferStatus(transfer) ?? "requested");

/** The direction and what the user gets; just the direction while a receive of any amount waits for its deposit. */
export const transferTitle = (transfer: OperatorTransfer): string =>
  isAmountUnknown(transfer)
    ? copy.direction[transfer.direction]
    : copy.transfers.summary(
        copy.direction[transfer.direction],
        formatSats(transferTerms(transfer).amount),
      );

/** How a message reads in a list or a bubble: its text, or what ecash it carries and whether it can pay a transfer. */
export const messageText = (text: string, mintUrl: string): string => {
  const content = messageContent(text);
  if (content._tag === "text") return content.text;
  return isTransferEcash(content, mintUrl)
    ? copy.chats.ecash(formatSats(content.amount), content.requestId !== null)
    : copy.chats.foreignEcash(
        content.amount,
        content.unit ?? "?",
        content.mint ?? "?",
      );
};
