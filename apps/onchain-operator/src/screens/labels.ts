import type { OperatorTransferStatus } from "@linky-fit/onchain-transfer";
import { copy } from "../copy/en";
import { messageContent } from "../domain/chat";
import { isTransferEcash } from "../domain/rules";
import {
  transferStatus,
  transferTerms,
  type OperatorTransfer,
} from "../domain/transfer";
import { formatSats } from "../format";

/** The status as the operator reads it; a request nobody answered yet waits for them. */
export const statusKey = (
  transfer: OperatorTransfer,
): OperatorTransferStatus | "requested" =>
  transferStatus(transfer) ?? "requested";

export const transferTitle = (transfer: OperatorTransfer): string =>
  copy.transfers.summary(
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
