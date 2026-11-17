import {
  EmptyState,
  Icon,
  ListRow,
  LoadingState,
  Pill,
  RailPill,
  Row,
  StatusDot,
  Text,
} from "@linky-fit/ui";
import { copy } from "../copy/en";
import { lastActivitySec, type Chat } from "../domain/chat";
import {
  reservedDepositAddresses,
  transferWait,
  type OperatorTransfer,
  type TransferWait,
} from "../domain/transfer";
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
        <ChatRow
          key={chat.peer}
          chat={chat}
          transfers={transfersOf(chat)}
          reservedAddresses={
            reservedDepositAddresses(transfers, chat.peer).length
          }
        />
      ))}
    </Page>
  );
}

/** The operator's moves first, then what the user still has to pay. */
const waitOrder: readonly TransferWait[] = [
  "review",
  "operatorCashu",
  "operatorOnchain",
  "userCashu",
  "userOnchain",
];

/** What the user's open transfers wait for: a solid pill where the operator acts, a soft one where the user does; Cashu violet, on-chain gold. */
function WaitPills({ waits }: { readonly waits: readonly TransferWait[] }) {
  return waitOrder.map((wait) => {
    const count = waits.filter((candidate) => candidate === wait).length;
    if (count === 0) return null;
    const label = copy.chats.waits[wait];
    const hint = count > 1 ? `×${count}` : undefined;
    if (wait === "review")
      return (
        <Pill key={wait} size="sm" tone="warning" label={label} hint={hint} />
      );
    return (
      <RailPill
        key={wait}
        testID={`chat-wait-${wait}`}
        size="sm"
        rail={wait.endsWith("Cashu") ? "cashu" : "onchain"}
        emphasis={wait.startsWith("operator") ? "solid" : "soft"}
        label={label}
        hint={hint}
      />
    );
  });
}

function ChatRow({
  chat,
  transfers,
  reservedAddresses,
}: {
  readonly chat: Chat;
  readonly transfers: readonly OperatorTransfer[];
  /** How many of the operator's deposit addresses the user holds without an open transfer. */
  readonly reservedAddresses: number;
}) {
  const { config } = useAppServices();
  const { name } = usePeerProfile(chat.peer);
  const last = chat.messages.at(-1);
  const lastSec = lastActivitySec(chat, transfers);
  const waits = transfers.flatMap((transfer) => {
    const wait = transfer.isTest ? null : transferWait(transfer);
    return wait === null ? [] : [wait];
  });
  return (
    <ListRow
      testID={`chat-row-${chat.peer}`}
      leading={<PeerAvatar pubkey={chat.peer} />}
      title={
        <Row gap="$xs" alignItems="center">
          <Text numberOfLines={1} flexShrink={1}>
            {name}
          </Text>
          {reservedAddresses > 0 ? (
            <Icon
              name="Bitcoin"
              size="sm"
              color="$onchainText"
              tooltip={copy.chats.reservedAddressTooltip(reservedAddresses)}
            />
          ) : null}
        </Row>
      }
      // Two lines: the preview sits beside the pills, which line up under the time.
      description={
        <Row gap="$sm" alignItems="center">
          <Text
            variant="caption"
            color="$colorMuted"
            numberOfLines={1}
            flex={1}
          >
            {last === undefined
              ? copy.chats.noMessages
              : messageText(last.text, config.mintUrl)}
          </Text>
          {chat.unread ? (
            <StatusDot tone="accent" accessibilityLabel={copy.chats.unread} />
          ) : null}
          <WaitPills waits={waits} />
        </Row>
      }
      meta={lastSec === 0 ? undefined : formatDateTime(lastSec)}
      onPress={() => navigateTo(chatRoute(chat.peer))}
    />
  );
}
