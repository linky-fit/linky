import {
  EmptyState,
  ListRow,
  LoadingState,
  Pill,
  Row,
  StatusDot,
} from "@linky-fit/ui";
import { copy } from "../copy/en";
import { lastActivitySec, type Chat } from "../domain/chat";
import { isOpen, type OperatorTransfer } from "../domain/transfer";
import { formatDateTime } from "../format";
import { messageText } from "./labels";
import { navigateTo } from "../platform/hashRoute";
import { chatRoute } from "../routing";
import {
  useAppServices,
  useChats,
  usePeerProfile,
  useTransfers,
} from "../services/react";
import { Page } from "./Page";
import { PeerAvatar } from "./Peer";

/** One chat per user, the most recent on top. */
export function ChatsScreen() {
  const chats = useChats();
  const transfers = useTransfers();
  if (chats === null || transfers === null)
    return <LoadingState label={copy.loading} />;
  const transfersOf = (chat: Chat) =>
    transfers.filter((transfer) => transfer.user === chat.peer);
  const sorted = [...chats].sort(
    (a, b) =>
      lastActivitySec(b, transfersOf(b)) - lastActivitySec(a, transfersOf(a)),
  );
  return (
    <Page title={copy.sections.chats} testID="chats-screen">
      {sorted.length === 0 ? (
        <EmptyState
          icon="MessageCircle"
          title={copy.chats.emptyTitle}
          description={copy.chats.emptyDescription}
        />
      ) : null}
      {sorted.map((chat) => (
        <ChatRow key={chat.peer} chat={chat} transfers={transfersOf(chat)} />
      ))}
    </Page>
  );
}

function ChatRow({
  chat,
  transfers,
}: {
  readonly chat: Chat;
  readonly transfers: readonly OperatorTransfer[];
}) {
  const { config } = useAppServices();
  const { name } = usePeerProfile(chat.peer);
  const last = chat.messages.at(-1);
  const open = transfers.filter(isOpen).length;
  const lastSec = lastActivitySec(chat, transfers);
  return (
    <ListRow
      testID={`chat-row-${chat.peer}`}
      leading={<PeerAvatar pubkey={chat.peer} />}
      title={name}
      description={
        last === undefined
          ? copy.chats.noMessages
          : messageText(last.text, config.mintUrl)
      }
      meta={lastSec === 0 ? undefined : formatDateTime(lastSec)}
      trailing={
        <Row gap="$sm">
          {open > 0 ? (
            <Pill
              size="sm"
              tone="warning"
              label={copy.chats.openTransfers(open)}
            />
          ) : null}
          {chat.unread ? (
            <StatusDot tone="accent" accessibilityLabel={copy.chats.unread} />
          ) : null}
        </Row>
      }
      onPress={() => navigateTo(chatRoute(chat.peer))}
    />
  );
}
