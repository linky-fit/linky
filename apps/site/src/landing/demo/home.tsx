import {
  Amount,
  Avatar,
  Button,
  ContactRow,
  Icon,
  IconButton,
  Pill,
  Row,
  Section,
  Stack,
  Text,
} from "@linky-fit/ui";
import { mintIcon } from "./chat";
import type { ReactNode } from "react";
import { DemoBody, DemoTabBar, DemoTopBar, type Tab } from "./chrome";
import { Tap } from "./flow";
import { noop } from "./noop";
import { avatarUri, type Person } from "./people";

export interface Conversation {
  person: Person;
  preview: string;
  /** The last message is a token of this amount, shown as a pill instead of the preview. */
  token?: string;
  time: string;
  outgoing?: boolean;
  unread?: boolean;
}

const pinned: Conversation = {
  person: "Mia Novak",
  preview: "Deal! See you Tuesday 💛",
  token: "21,000 sat",
  time: "06:42 PM",
  unread: true,
};

const proxyPayments: Conversation[] = [
  {
    person: "Eva Stone",
    preview: "Thanks for the playlist 🎶",
    time: "06:12 PM",
    unread: true,
  },
];

const conversations: Conversation[] = [
  {
    person: "Ben Ellis",
    preview: "I'll bring the board games 🎲",
    time: "05:57 PM",
    unread: true,
  },
  {
    person: "Alex Rivers",
    preview: "Can’t wait for the weekend!",
    time: "04:12 PM",
    unread: true,
  },
  {
    person: "Sofia Lane",
    preview: "See you at the farmers' market 🌿",
    time: "02:30 PM",
    outgoing: true,
  },
  { person: "Mom", preview: "Call me when you get home 💛", time: "11:05 AM" },
  {
    person: "Lena Fox",
    preview: "Saved you a seat at the café ☕",
    time: "Oct 2",
    outgoing: true,
  },
  { person: "Tomas Berg", preview: "Climbing on Thursday? 🧗", time: "Oct 1" },
];

function Contact({
  person,
  preview,
  token,
  time,
  outgoing,
  unread,
}: Conversation) {
  return (
    <ContactRow
      name={person}
      avatarUri={avatarUri(person)}
      preview={
        <Row gap="$xs">
          <Icon
            name={outgoing ? "ArrowUpRight" : "ArrowDownRight"}
            size="sm"
            color="$colorMuted"
          />
          {token ? (
            <Pill
              size="sm"
              tone="accent"
              label={token}
              leading={<Avatar name="Mint" uri={mintIcon} size="xs" />}
            />
          ) : (
            <Text
              variant="caption"
              color="$colorMuted"
              numberOfLines={1}
              flexShrink={1}
            >
              {preview}
            </Text>
          )}
        </Row>
      }
      time={time}
      unread={unread}
      onPress={noop}
    />
  );
}

const contactList = (list: Conversation[], tapped: Person | undefined) => (
  <Stack gap="$xs">
    {list.map((conversation) => (
      <Tap key={conversation.person} on={conversation.person === tapped}>
        <Contact {...conversation} />
      </Tap>
    ))}
  </Stack>
);

/** The Contacts tab; `latest` tops the conversations, `tapped` is touched and `children` float above, e.g. a toast. */
export function ContactsScreen({
  latest,
  tapped,
  tapTab,
  children,
}: {
  latest?: Conversation | undefined;
  tapped?: Person | undefined;
  tapTab?: Tab | undefined;
  children?: ReactNode;
}) {
  return (
    <>
      <DemoTopBar title="Contacts" trailing="Search" />
      <DemoBody position="relative">
        <Stack gap="$xs" paddingTop="$xxxl">
          <Tap on={pinned.person === tapped} data-guide="contact-card">
            <Contact {...pinned} />
          </Tap>
          <Section title="Proxy payments">
            {contactList(proxyPayments, tapped)}
          </Section>
          <Section title="Conversations">
            {contactList(
              latest ? [latest, ...conversations] : conversations,
              tapped,
            )}
          </Section>
        </Stack>
        <Stack position="absolute" right="$xl" bottom="$xxxl">
          <IconButton
            icon="UserPlus"
            variant="primary"
            size="lg"
            accessibilityLabel="Add contact"
            onPress={noop}
          />
        </Stack>
      </DemoBody>
      <DemoTabBar active="contacts" tap={tapTab} />
      {children}
    </>
  );
}

function WalletAction({
  icon,
  label,
}: {
  icon: "ArrowDownRight" | "ArrowUpRight";
  label: string;
}) {
  return (
    <Button
      variant="secondary"
      icon={icon}
      flexDirection="column"
      width="$column"
      paddingVertical="$xl"
      onPress={noop}
    >
      {label}
    </Button>
  );
}

export function WalletScreen() {
  return (
    <>
      <DemoTopBar title="Wallet" />
      <DemoBody paddingBottom="$lg">
        <Stack
          flex={1}
          justifyContent="center"
          alignItems="center"
          gap="$xxl"
          paddingBottom="$huge"
        >
          <Amount value="409,996" unit="sat" size="lg" />
          <Row marginTop="$md">
            <WalletAction icon="ArrowDownRight" label="Receive" />
            <WalletAction icon="ArrowUpRight" label="Send" />
          </Row>
          <Button variant="ghost" size="sm" onPress={noop}>
            Show transactions
          </Button>
        </Stack>
      </DemoBody>
      <DemoTabBar active="wallet" />
    </>
  );
}
