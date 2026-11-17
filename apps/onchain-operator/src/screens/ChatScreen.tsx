import type { Pubkey } from "@linky-fit/linkstr";
import { explorerAddressUrl } from "@linky-fit/onchain-transfer";
import {
  CodeBlock,
  IconButton,
  Notice,
  MessageBubble,
  MessageComposerFrame,
  ScrollView,
  Stack,
  Text,
  TextField,
  TopBar,
} from "@linky-fit/ui";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { copy } from "../copy/en";
import {
  chatTimeline,
  rawLog,
  type ChatMessage,
  type RawLogEntry,
} from "../domain/chat";
import { reservedDepositAddresses } from "../domain/transfer";
import { formatDateTime } from "../format";
import { navigateTo } from "../platform/hashRoute";
import { sectionRoute } from "../routing";
import {
  useAppServices,
  useChats,
  useTransferLog,
  useTransfers,
} from "../services/react";
import { messageText } from "./labels";
import { WithTopBar } from "./Page";
import { PeerSummary } from "./Peer";
import { TransferCard } from "./TransferParts";
import { TransferField } from "./TransferField";

const timeLabel = (message: ChatMessage) => {
  const time = formatDateTime(message.createdAtSec);
  if (message.direction === "in" || message.status === "sent") return time;
  return `${time} · ${message.status === "pending" ? copy.chats.sending : copy.chats.failed}`;
};

/** Everything the user sent, word for word, to settle a dispute by. */
function RawLog({ entries }: { readonly entries: readonly RawLogEntry[] }) {
  if (entries.length === 0)
    return <Text color="$colorMuted">{copy.chats.rawLogEmpty}</Text>;
  return entries.map((entry) => (
    <Stack key={entry.id} gap="$xs" testID="raw-log-entry">
      <Text variant="caption" color="$colorMuted">
        {`${formatDateTime(entry.atSec)} · ${
          entry._tag === "chat"
            ? copy.chats.rawChatMessage
            : copy.chats.rawTransferMessage(entry.transferId)
        }`}
      </Text>
      <CodeBlock>
        {entry._tag === "chat" ? entry.text : entry.content}
      </CodeBlock>
    </Stack>
  ));
}

/** The chat with one user: their messages and transfers in one timeline, and a composer; or everything they sent, raw. */
export function ChatScreen({ peer }: { readonly peer: Pubkey }) {
  const { chats, config } = useAppServices();
  const chat = useChats()?.find((candidate) => candidate.peer === peer);
  const allTransfers = useTransfers() ?? [];
  const transfers = allTransfers.filter((transfer) => transfer.user === peer);
  const reserved = reservedDepositAddresses(allTransfers, peer);
  const transferLog = useTransferLog() ?? [];
  const [raw, setRaw] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const list = useRef<ComponentRef<typeof ScrollView>>(null);

  const newestIncomingSec = chat?.messages
    .filter((message) => message.direction === "in")
    .at(-1)?.createdAtSec;
  const unread = chat?.unread ?? false;
  useEffect(() => {
    if (unread && newestIncomingSec !== undefined)
      void chats.markSeen(peer, newestIncomingSec);
  }, [chats, peer, unread, newestIncomingSec]);

  const send = async () => {
    const text = draft.trim();
    if (text === "" || sending) return;
    setSending(true);
    setFailed(false);
    try {
      await chats.send(peer, text);
      setDraft("");
    } catch (error) {
      console.warn("[onchain-operator] chat message not sent", error);
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <WithTopBar
      topBar={
        <TopBar
          content={<PeerSummary pubkey={peer} />}
          leading={
            <IconButton
              icon="ArrowLeft"
              accessibilityLabel={copy.back}
              onPress={() => navigateTo(sectionRoute("chats"))}
            />
          }
          trailing={
            <IconButton
              testID="chat-raw-log"
              icon={raw ? "MessageCircle" : "FileText"}
              accessibilityLabel={raw ? copy.chats.showChat : copy.chats.rawLog}
              onPress={() => setRaw((shown) => !shown)}
            />
          }
        />
      }
    >
      {reserved.length === 0 ? null : (
        <Stack
          testID="chat-reserved-addresses"
          width="100%"
          maxWidth="$sheetWidth"
          alignSelf="center"
          gap="$sm"
          paddingHorizontal="$xl"
          paddingTop="$md"
        >
          {reserved.map(({ address, addressIndex }) => (
            <Notice
              key={address}
              tone="info"
              icon="Bitcoin"
              title={copy.chats.reservedAddress}
              description={
                <Stack gap="$sm">
                  <Text variant="caption">
                    {copy.chats.reservedAddressHint}
                  </Text>
                  <TransferField
                    label={`${copy.transfer.depositAddress} · ${copy.transfer.addressIndex(addressIndex)}`}
                    value={address}
                    href={explorerAddressUrl(config.explorerUrl, address)}
                  />
                </Stack>
              }
            />
          ))}
        </Stack>
      )}
      <ScrollView
        ref={list}
        flex={1}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => list.current?.scrollToEnd()}
      >
        <Stack
          testID="chat-screen"
          flexGrow={1}
          width="100%"
          maxWidth="$sheetWidth"
          alignSelf="center"
          justifyContent="flex-end"
          gap="$md"
          paddingHorizontal="$xl"
          paddingVertical="$md"
        >
          {raw ? (
            <RawLog entries={rawLog(peer, chat?.messages ?? [], transferLog)} />
          ) : (
            chatTimeline(chat?.messages ?? [], transfers).map((item) =>
              item._tag === "transfer" ? (
                <TransferCard key={item.transfer.id} transfer={item.transfer} />
              ) : (
                <MessageBubble
                  key={item.message.id}
                  direction={
                    item.message.direction === "in" ? "incoming" : "outgoing"
                  }
                  time={timeLabel(item.message)}
                >
                  {messageText(item.message.text, config.mintUrl)}
                </MessageBubble>
              ),
            )
          )}
        </Stack>
      </ScrollView>
      <Stack
        data-safe-area="bottom"
        width="100%"
        maxWidth="$sheetWidth"
        alignSelf="center"
      >
        <MessageComposerFrame>
          <TextField
            testID="chat-input"
            label={copy.chats.placeholder}
            hideLabel
            placeholder={copy.chats.placeholder}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => void send()}
            enterKeyHint="send"
            error={failed ? copy.chats.sendFailed : undefined}
            trailing={
              <IconButton
                testID="chat-send"
                icon="Send"
                size="sm"
                variant="primary"
                accessibilityLabel={copy.chats.send}
                loading={sending}
                disabled={draft.trim() === ""}
                onPress={() => void send()}
              />
            }
          />
        </MessageComposerFrame>
      </Stack>
    </WithTopBar>
  );
}
