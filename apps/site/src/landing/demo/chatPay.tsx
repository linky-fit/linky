import {
  Amount,
  Avatar,
  Button,
  Card,
  DaySeparator,
  IconButton,
  MessageComposerFrame,
  RichTextInput,
  Row,
  Stack,
  Text,
  TextField,
} from "@linky-fit/ui";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Message, Token } from "./chat";
import { DemoBody, DemoTopBar } from "./chrome";
import { fill } from "./fill";
import { PaymentOverlay, Tap, TappedKeypad } from "./flow";
import { noop } from "./noop";
import { avatarUri } from "./people";
import { useCues } from "./playback";
import "./chatPay.css";

// In time order: `useCues` reports how many have passed.
const cues = {
  tapSend: 2100,
  send: 2400,
  tapPay: 3100,
  pay: 3400,
  tapNote: 5700,
  tapSubmit: 7300,
  sending: 7600,
  sent: 8800,
  dismissed: 10000,
  closed: 10400,
  reply: 11200,
};

type Cue = keyof typeof cues;
type At = (cue: Cue) => boolean;

// Module-level, so `useCues` keeps its timers across re-renders.
const cueOrder = Object.keys(cues);
const cueTimes = Object.values(cues);

const message = "Thank you! Coffee’s on me ☕";
const note = "Coffee next week";
const digits = ["5", "0", "0", "0"];

const typingTicks = (text: string, start: number) =>
  Array.from(text, (_, index) => start + index * 55);

// Ms after the chat or the pay page mounts.
const messageTicks = typingTicks(message, 500);
const digitTicks = [800, 1150, 1500, 1850];
const noteTicks = typingTicks(note, 2600);

function useTyped(text: string, ticks: readonly number[]) {
  return Array.from(text).slice(0, useCues(ticks)).join("");
}

function Arrive({ children }: { children: ReactNode }) {
  return <Stack className="chat-pay-arrive">{children}</Stack>;
}

function Composer({ at }: { at: At }) {
  const typed = useTyped(message, messageTicks);
  const draft = at("send") ? "" : typed;
  const input = useRef<HTMLDivElement>(null);
  // RichTextInput is a contentEditable host whose content the caller writes.
  useLayoutEffect(() => {
    if (input.current) input.current.textContent = draft;
  }, [draft]);
  return (
    <Stack paddingBottom="$xl">
      <MessageComposerFrame
        footer={
          <Row gap="$sm">
            <Button flex={1} variant="secondary" icon="Request" onPress={noop}>
              Request
            </Button>
            <Tap on={at("tapPay")} flex={1}>
              <Button variant="secondary" icon="HandCoins" onPress={noop}>
                Pay
              </Button>
            </Tap>
          </Row>
        }
      >
        <RichTextInput
          ref={input}
          placeholder="Message"
          empty={draft === ""}
          trailing={
            draft ? (
              <Tap on={at("tapSend")}>
                <IconButton
                  icon="Send"
                  variant="primary"
                  size="sm"
                  accessibilityLabel="Send"
                  onPress={noop}
                />
              </Tap>
            ) : (
              <IconButton
                icon="Images"
                variant="secondary"
                size="sm"
                accessibilityLabel="Attach images"
                onPress={noop}
              />
            )
          }
        />
      </MessageComposerFrame>
    </Stack>
  );
}

function ChatScene({ at }: { at: At }) {
  return (
    <>
      <DemoTopBar contact="Mia Novak" leading="ChevronLeft" trailing="Pencil" />
      <DemoBody gap="$sm" paddingTop="$lg">
        <DaySeparator label="Today" />
        <Message>Dinner was great, thanks!</Message>
        <Message outgoing>So good to see you! Same place next week?</Message>
        <Message>Absolutely 😊 Here’s my half 🍝</Message>
        <Message>
          <Token amount="21,000 sat" memo="Dinner 🍝" />
        </Message>
        {at("send") ? (
          <Arrive>
            <Message outgoing>{message}</Message>
          </Arrive>
        ) : null}
        {at("dismissed") ? (
          <Arrive>
            <Message outgoing>
              <Token amount="5,000 sat" memo={note} />
            </Message>
          </Arrive>
        ) : null}
        {at("reply") ? (
          <Arrive>
            <Message time="06:41 PM">Deal! See you Tuesday 💛</Message>
          </Arrive>
        ) : null}
      </DemoBody>
      <Composer at={at} />
    </>
  );
}

function PayScene({ at }: { at: At }) {
  const pressed = useCues(digitTicks);
  const amount = Number(digits.slice(0, pressed).join(""));
  const typedNote = useTyped(note, noteTicks);
  return (
    <>
      <DemoTopBar
        title="Pay to contact"
        leading="ChevronLeft"
        trailing="Settings"
      />
      <DemoBody paddingTop="$lg">
        <Row>
          <Avatar name="Mia Novak" uri={avatarUri("Mia Novak")} size="md" />
          <Stack flex={1} gap="$xxs">
            <Row gap="$sm">
              <Text variant="title" numberOfLines={1} flexShrink={1}>
                Mia Novak
              </Text>
              <IconButton
                icon="Bean"
                accessibilityLabel="Cashu"
                size="sm"
                variant="secondary"
                onPress={noop}
              />
            </Row>
            <Button
              variant="ghost"
              size="sm"
              alignSelf="flex-start"
              onPress={noop}
            >
              available: 409,996 sat
            </Button>
          </Stack>
        </Row>
        <Card>
          <Stack alignSelf="center">
            <Amount
              value={amount.toLocaleString("en-US")}
              unit="sat"
              size="lg"
            />
          </Stack>
        </Card>
        <Tap on={at("tapNote")}>
          <TextField
            label="Note"
            hideLabel
            placeholder="Add a note"
            value={typedNote}
            onChangeText={noop}
            textAlign="center"
          />
        </Tap>
        <TappedKeypad pressedKey={digits[pressed - 1]} press={pressed} />
        <Tap on={at("tapSubmit")}>
          <Button
            icon="HandCoins"
            disabled={amount === 0}
            loading={at("tapSubmit")}
            onPress={noop}
          >
            Pay
          </Button>
        </Tap>
      </DemoBody>
    </>
  );
}

function chatLayerClass(at: At) {
  if (at("sent")) return "chat-pay-back-in";
  return at("pay") ? "flow-push-out" : "";
}

/** Thanking a friend, paying them from the chat and getting their reply. */
export function ChatPayFlowScreen() {
  const passed = useCues(cueTimes);
  const at: At = (cue) => passed > cueOrder.indexOf(cue);
  const sent = at("sent");
  return (
    <Stack flex={1} position="relative" overflow="hidden">
      <Stack
        className={`flow-scene ${chatLayerClass(at)}`}
        {...fill}
        backgroundColor="$background"
      >
        <ChatScene at={at} />
      </Stack>
      {at("pay") && !at("closed") ? (
        <Stack
          className={`flow-scene ${sent ? "chat-pay-back-out" : "flow-push-in"}`}
          {...fill}
          backgroundColor="$background"
        >
          <PayScene at={at} />
        </Stack>
      ) : null}
      {at("sending") && !at("closed") ? (
        <PaymentOverlay
          title={sent ? "Sent" : "Sending…"}
          amount="5,000"
          person="Mia Novak"
          direction="out"
          pending={!sent}
          hidden={at("dismissed")}
        />
      ) : null}
    </Stack>
  );
}
