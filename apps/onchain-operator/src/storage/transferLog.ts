import {
  onchainTransferMessageIdFor,
  type OnchainTransferId,
} from "@linky-fit/domain";
import { Pubkey, type AppMessageReceived } from "@linky-fit/linkstr";
import {
  NonEmptyString,
  NonEmptyString100,
  PositiveInt,
  type OnchainTransferMessagesRepository,
  type ShardDbError,
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
          rumorId: NonEmptyString100.orThrow(event.messageId),
          peerPubkey: NonEmptyString100.orThrow(event.from),
          ...(transferId === null ? {} : { transferId }),
          content: NonEmptyString.orThrow(event.content),
          sentAtSec: PositiveInt.orThrow(event.sentAt),
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
