import {
  Amount,
  Avatar,
  Button,
  DaySeparator,
  Icon,
  IconButton,
  MessageBubble,
  MessageComposerFrame,
  Pill,
  RichTextInput,
  Row,
  Stack,
  Text,
} from "@linky-fit/ui";
import { border, shadow } from "@linky-fit/ui/tokens";
import type { ReactNode } from "react";
import { DemoBody, DemoTopBar } from "./chrome";
import { noop } from "./noop";
import { avatarUri, type Person } from "./people";
import { enter, useCues } from "./playback";

function Message({
  outgoing = false,
  time,
  className = "",
  children,
}: {
  outgoing?: boolean;
  time?: string;
  className?: string;
  children: ReactNode;
}) {
  const body =
    typeof children === "string" ? <Text>{children}</Text> : children;
  return (
    <MessageBubble
      className={className}
      direction={outgoing ? "outgoing" : "incoming"}
      footer={
        time ? (
          <Text variant="caption" color="$colorMuted">
            {time}
          </Text>
        ) : undefined
      }
    >
      {outgoing ? (
        <Row alignItems="flex-end" gap="$sm">
          <Stack flexShrink={1}>{body}</Stack>
          <Icon name="CheckCheck" size="sm" color="$accent" />
        </Row>
      ) : (
        body
      )}
    </MessageBubble>
  );
}

// Mints publish their own icon picture; this stands in for one, theme-independent like the real image.
const mintIcon = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><linearGradient id="g" x2="1" y2="1"><stop stop-color="#2dd4bf"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient><circle cx="12" cy="12" r="12" fill="url(#g)"/><text x="12" y="16.5" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="700" font-size="13" fill="#fff">M</text></svg>',
)}`;

function Token({ amount, memo }: { amount: string; memo: string }) {
  return (
    <Pill
      label={amount}
      hint={memo}
      tone="neutral"
      leading={<Avatar name="Mint" uri={mintIcon} size="xs" />}
    />
  );
}

function ChatScreen({
  contact,
  children,
}: {
  contact: Person;
  children: ReactNode;
}) {
  return (
    <>
      <DemoTopBar contact={contact} leading="ChevronLeft" trailing="Pencil" />
      <DemoBody gap="$sm" paddingTop="$lg">
        <DaySeparator label="Today" />
        {children}
      </DemoBody>
      <Stack paddingBottom="$xl">
        <MessageComposerFrame
          footer={
            <Row gap="$sm">
              <Button
                flex={1}
                variant="secondary"
                icon="Request"
                onPress={noop}
              >
                Request
              </Button>
              <Button
                flex={1}
                variant="secondary"
                icon="HandCoins"
                onPress={noop}
              >
                Pay
              </Button>
            </Row>
          }
        >
          <RichTextInput
            placeholder="Message"
            empty
            trailing={
              <IconButton
                icon="Images"
                variant="secondary"
                size="sm"
                accessibilityLabel="Attach images"
                onPress={noop}
              />
            }
          />
        </MessageComposerFrame>
      </Stack>
    </>
  );
}

/** The app's payment confirmation, kept inside the phone instead of portaled over the page. */
function PaymentReceived({ from, amount }: { from: Person; amount: string }) {
  return (
    <Stack
      className="demo-overlay"
      position="absolute"
      inset="$none"
      zIndex="$overlay"
      justifyContent="center"
      padding="$lg"
      backgroundColor="$scrim"
    >
      <Stack
        className="demo-pop"
        alignItems="center"
        gap="$md"
        padding="$xxl"
        borderRadius="$card"
        backgroundColor="$surface"
        boxShadow={shadow.floating}
      >
        <Stack position="relative">
          <Avatar name={from} uri={avatarUri(from)} size="lg" />
          <div className="demo-badge">
            <Stack
              width="$controlSm"
              height="$controlSm"
              borderRadius="$pill"
              borderWidth={border.focus}
              borderColor="$surface"
              backgroundColor="$accent"
              alignItems="center"
              justifyContent="center"
            >
              <Icon name="ArrowDown" size="sm" color="$colorStrong" />
            </Stack>
          </div>
        </Stack>
        <Text variant="label" fontWeight="$regular" color="$colorMuted">
          {from}
        </Text>
        <Text variant="heading">Payment received</Text>
        <Amount value={amount} unit="sat" size="md" />
      </Stack>
    </Stack>
  );
}

// Messages, the received token, its confirmation, then the replies.
const paymentCues = [200, 450, 700, 1000, 1200, 2450, 2650, 2850];

export function ChatPaymentScreen() {
  const passed = useCues(paymentCues);
  return (
    <>
      <ChatScreen contact="Mia Novak">
        <Message className={enter(passed > 0)}>
          Dinner was great, thanks!
        </Message>
        <Message outgoing className={enter(passed > 1)}>
          So good to see you! Same place next week?
        </Message>
        <Message className={enter(passed > 2)}>
          Absolutely 😊 Here’s my half 🍝
        </Message>
        <Message className={enter(passed > 3, "demo-pop")}>
          <Token amount="21,000 sat" memo="Dinner 🍝" />
        </Message>
        <Message outgoing className={enter(passed > 5)}>
          Thank you! Coffee’s on me ☕
        </Message>
        <Message outgoing className={enter(passed > 6)}>
          <Token amount="5,000 sat" memo="Coffee next week" />
        </Message>
        <Message time="06:41 PM" className={enter(passed > 7)}>
          Deal! See you Tuesday 💛
        </Message>
      </ChatScreen>
      {passed > 4 ? <PaymentReceived from="Mia Novak" amount="21,000" /> : null}
    </>
  );
}

// Messages, the request card, the reply, then the card's emphasis.
const requestCues = [200, 450, 800, 1300, 1700, 2000];

export function ChatRequestScreen() {
  const passed = useCues(requestCues);
  return (
    <ChatScreen contact="Alex Rivers">
      <Message className={enter(passed > 0)}>
        I’ve booked our train tickets 🚆
      </Message>
      <Message outgoing className={enter(passed > 1)}>
        Perfect! Send me my share.
      </Message>
      <Message className={enter(passed > 2)}>
        <Stack gap="$sm" minWidth="$qr">
          <Row justifyContent="space-between" gap="$sm">
            <Text eyebrow>Payment request</Text>
            <Stack className={passed > 4 ? "demo-nudge" : ""}>
              <Pill size="sm" label="Requested" tone="warning" />
            </Stack>
          </Row>
          <Row>
            <Amount size="md" value="21,000" unit="sat" />
          </Row>
          <Text variant="caption" color="$colorMuted">
            Weekend in Brno
          </Text>
          <Row gap="$sm">
            <Stack flex={1} className={passed > 5 ? "demo-nudge" : ""}>
              <Button icon="HandCoins" onPress={noop}>
                Pay
              </Button>
            </Stack>
            <Button flex={1} icon="X" variant="secondary" onPress={noop}>
              Decline
            </Button>
          </Row>
        </Stack>
      </Message>
      <Message time="06:41 PM" className={enter(passed > 3)}>
        Can’t wait for the weekend!
      </Message>
    </ChatScreen>
  );
}
