import {
  Amount,
  Avatar,
  Button,
  Card,
  IconButton,
  Pill,
  Row,
  Stack,
  Text,
  TextField,
} from "@linky-fit/ui";
import { border } from "@linky-fit/ui/tokens";
import type { ReactNode } from "react";
import { ChatScreen, Message, Token } from "./chat";
import { DemoBody, DemoTopBar } from "./chrome";
import { fill } from "./fill";
import { PaymentOverlay, Tap, TappedKeypad } from "./flow";
import { noop } from "./noop";
import { avatarUri } from "./people";
import { useCues, useFlow } from "./playback";
import "./chatRequest.css";

// In time order: `useFlow` reports which have passed.
const cues = {
  tapRequest: 900,
  request: 1200,
  tapNote: 3900,
  tapSend: 5300,
  back: 5600,
  sent: 5800,
  closed: 6100,
  paid: 7400,
  received: 7900,
  dismissed: 9400,
  overlayClosed: 9700,
  thanks: 10200,
};

type At = (cue: keyof typeof cues) => boolean;

// Ms after the request page mounts.
const presses = [
  { key: "2", at: 700 },
  { key: "1", at: 1100 },
  { key: "0", at: 1450 },
  { key: "0", at: 1800 },
  { key: "0", at: 2150 },
];
const pressTimes = presses.map(({ at }) => at);

const note = "Weekend in Brno";
const noteTimes = Array.from(note, (_, index) => 2950 + index * 55);

function RequestScene({ at }: { at: At }) {
  const pressed = useCues(pressTimes);
  const typed = presses
    .slice(0, pressed)
    .map(({ key }) => key)
    .join("");
  const noteLength = useCues(noteTimes);
  return (
    <>
      <DemoTopBar
        title="Pay to contact"
        leading="ChevronLeft"
        trailing="Settings"
      />
      <DemoBody paddingTop="$lg">
        <Row>
          <Avatar name="Alex Rivers" uri={avatarUri("Alex Rivers")} size="md" />
          <Stack flex={1} gap="$xxs">
            <Row gap="$sm">
              <Text variant="title">Alex Rivers</Text>
              <IconButton
                icon="Request"
                accessibilityLabel="Cashu"
                size="sm"
                variant="secondary"
                disabled
                onPress={noop}
              />
            </Row>
            <Text color="$colorMuted">
              Ask this contact to pay the amount below.
            </Text>
          </Stack>
        </Row>
        <Card>
          <Stack alignSelf="center">
            <Amount value={typed || "0"} unit="sat" size="lg" />
          </Stack>
        </Card>
        <Tap on={at("tapNote")}>
          <TextField
            label="Note"
            hideLabel
            placeholder="Add a note"
            value={note.slice(0, noteLength)}
            readOnly
            textAlign="center"
          />
        </Tap>
        <TappedKeypad pressedKey={presses[pressed - 1]?.key} press={pressed} />
        <Tap on={at("tapSend")}>
          <Button icon="Request" disabled={!typed} onPress={noop}>
            Request
          </Button>
        </Tap>
      </DemoBody>
    </>
  );
}

/** A message that slides in when it arrives during the flow. */
function Arriving({ children }: { children: ReactNode }) {
  return <Stack className="chat-request-arrive">{children}</Stack>;
}

function RequestCard({ paid }: { paid: boolean }) {
  return (
    <Stack gap="$sm" minWidth="$qr">
      <Row justifyContent="space-between" gap="$sm">
        <Text eyebrow>Payment request</Text>
        <Stack key={String(paid)} className={paid ? "chat-request-flip" : ""}>
          <Pill
            size="sm"
            label={paid ? "Paid" : "Requested"}
            tone={paid ? "accent" : "warning"}
          />
        </Stack>
      </Row>
      <Row>
        <Amount size="md" value="21,000" unit="sat" />
      </Row>
      <Text variant="caption" color="$colorMuted">
        {note}
      </Text>
    </Stack>
  );
}

function ChatScene({ at }: { at: At }) {
  return (
    <>
      <ChatScreen contact="Alex Rivers">
        <Message outgoing>I’ve booked our train tickets 🚆</Message>
        <Message>Amazing, thanks! Send me a request for my half.</Message>
        {at("sent") ? (
          <Arriving>
            <Message outgoing>
              <RequestCard paid={at("paid")} />
            </Message>
          </Arriving>
        ) : null}
        {at("paid") ? (
          <Arriving>
            <Message>
              <Stack
                borderLeftWidth={border.emphasis}
                borderColor="$info"
                paddingLeft="$sm"
              >
                <Text variant="caption" color="$colorSubtle">
                  You are requesting 21,000 sat
                </Text>
              </Stack>
              <Token amount="21,000 sat" memo={note} />
            </Message>
          </Arriving>
        ) : null}
        {at("thanks") ? (
          <Arriving>
            <Message time="06:41 PM">Thanks for organising! 🙌</Message>
          </Arriving>
        ) : null}
      </ChatScreen>
      {/* The composer's Request button, on the footer row ChatScreen draws. */}
      <Row
        position="absolute"
        bottom="$xxxl"
        left="$xl"
        right="$xl"
        height="$control"
        gap="$sm"
        pointerEvents="none"
      >
        <Tap on={at("tapRequest")} flex={1} />
        <Stack flex={1} />
      </Row>
    </>
  );
}

/** Requesting a friend's share in the chat, from the keypad to the paid request. */
export function ChatRequestFlowScreen() {
  const at = useFlow(cues);
  const chatMotion = at("back")
    ? "chat-request-pop-in"
    : at("request")
      ? "flow-push-out"
      : "";
  return (
    <Stack flex={1} position="relative" overflow="hidden">
      <Stack
        className={`flow-scene ${chatMotion}`}
        {...fill}
        backgroundColor="$background"
      >
        <ChatScene at={at} />
      </Stack>
      {at("request") && !at("closed") ? (
        <Stack
          className={`flow-scene ${at("back") ? "chat-request-pop-out" : "flow-push-in"}`}
          {...fill}
          backgroundColor="$background"
        >
          <RequestScene at={at} />
        </Stack>
      ) : null}
      {at("received") && !at("overlayClosed") ? (
        <PaymentOverlay
          title="Received"
          amount="21,000"
          person="Alex Rivers"
          direction="in"
          hidden={at("dismissed")}
        />
      ) : null}
    </Stack>
  );
}
