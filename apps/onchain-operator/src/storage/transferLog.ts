import {
  onchainTransferMessageIdFor,
  type OnchainTransferId,
} from "@linky-fit/domain";
import { Pubkey, type AppMessageReceived } from "@linky-fit/linkstr";
import type {
  OnchainTransferMessagesRepository,
  ShardDbError,
} from "@linky-fit/linksync";
import { Effect, Schema } from "effect";
import type { ReceivedTransferMessage } from "../domain/chat";

const isPubkey = Schema.is(Pubkey);

/** Keeps the message once per rumor; an empty one carries nothing to keep. */
export const logTransferMessage = (
  messages: OnchainTransferMessagesRepository,
  event: AppMessageReceived,
  transferId: OnchainTransferId | null,
): Effect.Effect<void, ShardDbError> =>
  event.content === ""
    ? Effect.void
    : Effect.asVoid(
        messages.insertIfAbsent({
          id: onchainTransferMessageIdFor(event.messageId),
          rumorId: event.messageId,
          peerPubkey: event.from,
          ...(transferId === null ? {} : { transferId }),
          content: event.content,
          sentAtSec: event.sentAt,
        }),
      );

/** Every logged message, oldest first; a row still arriving column by column is skipped. */
export const readTransferLog = (
  messages: OnchainTransferMessagesRepository,
): Effect.Effect<readonly ReceivedTransferMessage[]> =>
  Effect.map(messages.all, (rows) =>
    rows
      .flatMap(({ rumorId, peerPubkey, transferId, content, sentAtSec }) =>
        rumorId !== null &&
        isPubkey(peerPubkey) &&
        content !== null &&
        sentAtSec !== null
          ? [{ rumorId, from: peerPubkey, transferId, content, sentAtSec }]
          : [],
      )
      .sort((a, b) => a.sentAtSec - b.sentAtSec),
  );
