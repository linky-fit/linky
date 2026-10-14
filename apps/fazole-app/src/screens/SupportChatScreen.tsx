import {
  DaySeparator,
  EmptyState,
  IconButton,
  MessageBubble,
  MessageComposerFrame,
  ScrollView,
  Stack,
  TextField,
  TopBar,
} from "@linky-fit/ui";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { copy } from "../copy";
import { relativeDay, supportChatDays, type SupportMessage } from "../domain";
import { formatDay, formatTime } from "../format";
import { navigateTo } from "../platform/hashRoute";
import { useAppServices, useSupportChat } from "../services/react";
import { nowSeconds } from "../utils/time";
import { WithTopBar } from "./Page";

const toSettings = () => navigateTo("settings");

const dayLabel = (startSec: number, nowSec: number) => {
  const relative = relativeDay(startSec, nowSec);
  return relative === "today"
    ? copy.history.today
    : relative === "yesterday"
      ? copy.history.yesterday
      : formatDay(startSec);
};

const timeLabel = (message: SupportMessage) => {
  const time = formatTime(message.createdAtSec);
  if (message.direction === "in" || message.status === "sent") return time;
  return `${time} · ${message.status === "pending" ? copy.support.sending : copy.support.failed}`;
};

/** The merchant's chat with Fazole support, opened from the settings. */
export function SupportChatScreen() {
  const { supportChat } = useAppServices();
  const chat = useSupportChat();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [nowSec] = useState(nowSeconds);
  const list = useRef<ComponentRef<typeof ScrollView>>(null);

  const newestIncomingSec = chat?.messages
    .filter((message) => message.direction === "in")
    .at(-1)?.createdAtSec;
  const unread = chat?.unread ?? false;
  useEffect(() => {
    if (unread && newestIncomingSec !== undefined) {
      void supportChat.markSeen(newestIncomingSec);
    }
  }, [supportChat, unread, newestIncomingSec]);

  const send = async () => {
    const text = draft.trim();
    if (text === "" || sending) return;
    setSending(true);
    setFailed(false);
    try {
      await supportChat.send(text);
      setDraft("");
    } catch (error) {
      console.warn("[fazole] support message not sent", error);
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <WithTopBar
      topBar={
        <TopBar
          title={copy.support.title}
          leading={
            <IconButton
              testID="support-back"
              icon="ArrowLeft"
              accessibilityLabel={copy.back}
              onPress={toSettings}
            />
          }
        />
      }
    >
      <ScrollView
        ref={list}
        flex={1}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => list.current?.scrollToEnd()}
      >
        <Stack
          testID="support-screen"
          flexGrow={1}
          width="100%"
          maxWidth="$sheetWidth"
          alignSelf="center"
          justifyContent="flex-end"
          gap="$md"
          paddingHorizontal="$xl"
          paddingVertical="$md"
        >
          {chat !== null && chat.messages.length === 0 ? (
            <EmptyState
              icon="MessageCircle"
              title={copy.support.emptyTitle}
              description={copy.support.emptyDescription}
            />
          ) : null}
          {supportChatDays(chat?.messages ?? []).map((day) => (
            <Stack key={day.startSec} gap="$sm">
              <DaySeparator label={dayLabel(day.startSec, nowSec)} />
              {day.messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  testID={`support-message-${message.direction}`}
                  direction={
                    message.direction === "in" ? "incoming" : "outgoing"
                  }
                  time={timeLabel(message)}
                >
                  {message.text}
                </MessageBubble>
              ))}
            </Stack>
          ))}
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
            testID="support-input"
            label={copy.support.placeholder}
            hideLabel
            placeholder={copy.support.placeholder}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => void send()}
            enterKeyHint="send"
            error={failed ? copy.support.sendFailed : undefined}
            trailing={
              <IconButton
                testID="support-send"
                icon="Send"
                size="sm"
                variant="primary"
                accessibilityLabel={copy.support.send}
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
