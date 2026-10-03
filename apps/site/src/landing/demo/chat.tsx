import {
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

export function Message({
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
export const mintIcon = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><linearGradient id="g" x2="1" y2="1"><stop stop-color="#2dd4bf"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient><circle cx="12" cy="12" r="12" fill="url(#g)"/><text x="12" y="16.5" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="700" font-size="13" fill="#fff">M</text></svg>',
)}`;

export function Token({ amount, memo }: { amount: string; memo: string }) {
  return (
    <Pill
      label={amount}
      hint={memo}
      tone="accent"
      leading={<Avatar name="Mint" uri={mintIcon} size="xs" />}
    />
  );
}

export function ChatScreen({
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
