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
import type { ReactNode } from "react";
import { DemoBody, DemoTopBar } from "./chrome";
import { noop } from "./noop";
import type { Person } from "./people";

function Message({
  outgoing = false,
  time,
  children,
}: {
  outgoing?: boolean;
  time?: string;
  children: ReactNode;
}) {
  const body =
    typeof children === "string" ? <Text>{children}</Text> : children;
  return (
    <MessageBubble
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
      <MessageComposerFrame
        footer={
          <Row gap="$sm">
            <Button flex={1} variant="secondary" icon="Request" onPress={noop}>
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
    </>
  );
}

export function ChatPaymentScreen() {
  return (
    <ChatScreen contact="Mia Novak">
      <Message>Dinner was great, thanks!</Message>
      <Message outgoing>So good to see you! Same place next week?</Message>
      <Message>Absolutely 😊 Here’s my half 🍝</Message>
      <Message>
        <Token amount="21,000 sat" memo="Dinner 🍝" />
      </Message>
      <Message outgoing>Thank you! Coffee’s on me ☕</Message>
      <Message outgoing>
        <Token amount="5,000 sat" memo="Coffee next week" />
      </Message>
      <Message time="06:41 PM">Deal! See you Tuesday 💛</Message>
    </ChatScreen>
  );
}

export function ChatRequestScreen() {
  return (
    <ChatScreen contact="Alex Rivers">
      <Message>I’ve booked our train tickets 🚆</Message>
      <Message outgoing>Perfect! Send me my share.</Message>
      <Message>
        <Stack gap="$sm" minWidth="$qr">
          <Row justifyContent="space-between" gap="$sm">
            <Text eyebrow>Payment request</Text>
            <Pill size="sm" label="Requested" tone="warning" />
          </Row>
          <Row>
            <Amount size="md" value="21,000" unit="sat" />
          </Row>
          <Text variant="caption" color="$colorMuted">
            Weekend in Brno
          </Text>
          <Row gap="$sm">
            <Button flex={1} icon="HandCoins" onPress={noop}>
              Pay
            </Button>
            <Button flex={1} icon="X" variant="secondary" onPress={noop}>
              Decline
            </Button>
          </Row>
        </Stack>
      </Message>
      <Message time="06:41 PM">Can’t wait for the weekend!</Message>
    </ChatScreen>
  );
}
