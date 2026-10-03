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
import { DemoBody, DemoTabBar, DemoTopBar, RowHighlight } from "./chrome";
import { noop } from "./noop";
import { avatarUri, type Person } from "./people";
import { enter, useCountUp, useCues } from "./playback";

interface Conversation {
  person: Person;
  preview: string;
  time: string;
  outgoing?: boolean;
  unread?: boolean;
}

const pinnedBefore: Conversation = {
  person: "Eva Stone",
  preview: "Here’s the playlist for Saturday",
  time: "06:12 PM",
  outgoing: true,
};

const pinnedAfter: Conversation = {
  person: "Eva Stone",
  preview: "Thanks for the playlist 🎶",
  time: "06:42 PM",
  unread: true,
};

const proxyPayments: Conversation[] = [
  {
    person: "Mia Novak",
    preview: "Deal! See you Tuesday 💛",
    time: "06:41 PM",
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
  time,
  outgoing,
  unread,
  previewClassName = "",
}: Conversation & { previewClassName?: string }) {
  return (
    <ContactRow
      name={person}
      avatarUri={avatarUri(person)}
      preview={
        <Row key={preview} gap="$xs" className={previewClassName}>
          <Icon
            name={outgoing ? "ArrowUpRight" : "ArrowDownRight"}
            size="sm"
            color="$colorMuted"
          />
          <Text
            variant="caption"
            color="$colorMuted"
            numberOfLines={1}
            flexShrink={1}
          >
            {preview}
          </Text>
        </Row>
      }
      time={time}
      unread={unread}
      onPress={noop}
    />
  );
}

const contactList = (list: Conversation[]) => (
  <Stack gap="$xs">
    {list.map((conversation) => (
      <Contact key={conversation.person} {...conversation} />
    ))}
  </Stack>
);

const contactsCues = [1400];

export function ContactsScreen() {
  const updated = useCues(contactsCues) > 0;
  return (
    <>
      <DemoTopBar title="Contacts" trailing="Filter" />
      <DemoBody position="relative">
        <Stack gap="$xs" paddingTop="$xxxl">
          <Stack position="relative" className={updated ? "demo-unread" : ""}>
            {updated ? <RowHighlight className="demo-flash" /> : null}
            <Contact
              {...(updated ? pinnedAfter : pinnedBefore)}
              previewClassName={updated ? "demo-in" : ""}
            />
          </Stack>
          <Section title="Proxy payments">{contactList(proxyPayments)}</Section>
          <Section title="Conversations">{contactList(conversations)}</Section>
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
      <DemoTabBar active="contacts" />
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

const received = 21_000;
const balance = 409_996;
const walletCues = [1000];

export function WalletScreen() {
  const shown = useCues(walletCues) > 0;
  const value = useCountUp(balance - received, balance, 1100, 1100);
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
          <Stack alignItems="center" gap="$md">
            <Amount
              value={Math.round(value).toLocaleString("en-US")}
              unit="sat"
              size="lg"
            />
            <Stack className={enter(shown, "demo-pop")}>
              <Pill
                tone="accent"
                label={`+${received.toLocaleString("en-US")} sat`}
                leading={
                  <Avatar
                    name="Mia Novak"
                    uri={avatarUri("Mia Novak")}
                    size="xs"
                  />
                }
              />
            </Stack>
          </Stack>
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
