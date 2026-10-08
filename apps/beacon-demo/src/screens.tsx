import {
  Avatar,
  AvatarGroup,
  Pill,
  Button,
  ContactRow,
  DaySeparator,
  Divider,
  Icon,
  IconButton,
  ListRow,
  MessageBubble,
  MessageComposerFrame,
  Notice,
  RichTextInput,
  Row,
  Section,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextField,
  type IconName,
} from "@linky-fit/ui";
import type { ReactNode } from "react";
import {
  AndroidNotification,
  NearbyBanner,
  PermissionDialog,
  StoriesRow,
  Tapped,
} from "./beacon";
import { AppBody, AppTabBar, AppTopBar } from "./chrome";
import { noop } from "./noop";
import { avatarUri, type Person } from "./people";
import { tradeLabel, type NearbyContact, type Trade } from "./trade";

const introPoints: readonly { icon: IconName; text: string }[] = [
  {
    icon: "Users",
    text: "Contacts who also saved you see that you are nearby and what you want to trade.",
  },
  {
    icon: "Bell",
    text: "Needs Bluetooth, and shows a notification while it runs.",
  },
  {
    icon: "ShieldCheck",
    text: "Only mutual contacts can read it. While Linky is open, people nearby can see your npub to add you.",
  },
];

/** Shown the first time the beacon switch is turned on. */
export function BeaconIntroScreen({
  tapTurnOn = false,
}: {
  tapTurnOn?: boolean;
}) {
  return (
    <>
      <AppTopBar leading="X" />
      <AppBody gap="$xxl" paddingTop="$xxxl" paddingBottom="$huge">
        <Stack
          alignSelf="center"
          padding="$xl"
          borderRadius="$pill"
          backgroundColor="$accentSoft"
        >
          <Icon name="Radio" size="xl" color="$accentText" />
        </Stack>
        <Text variant="heading" color="$colorStrong" textAlign="center">
          Let nearby contacts find you
        </Text>
        <Stack gap="$lg">
          {introPoints.map(({ icon, text }) => (
            <Row key={icon} gap="$md" alignItems="flex-start">
              <Icon name={icon} color="$accentText" />
              <Text flex={1} color="$colorSubtle">
                {text}
              </Text>
            </Row>
          ))}
        </Stack>
        <Stack flex={1} justifyContent="flex-end" gap="$sm">
          <Tapped on={tapTurnOn}>
            <Button icon="Radio" onPress={noop}>
              Turn on beacon
            </Button>
          </Tapped>
          <Button variant="ghost" onPress={noop}>
            Not now
          </Button>
        </Stack>
      </AppBody>
    </>
  );
}

const tradeOptions = [
  { value: "none", label: "None" },
  { value: "buy", label: tradeLabel("buy") },
  { value: "sell", label: tradeLabel("sell") },
] as const;

export type BeaconState = "off" | "asking" | "denied" | "on";

type ProfileCurrency = "CZK" | "EUR" | "BRL";

const earnRows: readonly {
  currency: ProfileCurrency;
  label: string;
  on: boolean;
}[] = [
  { currency: "CZK", label: "Payments in CZK", on: true },
  { currency: "EUR", label: "Payments in EUR", on: false },
  { currency: "BRL", label: "Payments in BRL (Pix)", on: false },
];

const payers: readonly {
  currency: ProfileCurrency;
  people: readonly Person[];
}[] = [
  { currency: "CZK", people: ["Jan Kral", "Tomas Berg"] },
  { currency: "EUR", people: ["Lena Fox"] },
];

function PayerRow({
  currency,
  people,
}: {
  currency: ProfileCurrency;
  people: readonly Person[];
}) {
  return (
    <Row>
      <Stack>
        <Pill label={currency} size="sm" />
      </Stack>
      <AvatarGroup
        people={people.map((name) => ({ name, uri: avatarUri(name) }))}
      />
      <Text
        variant="label"
        color="$colorMuted"
        numberOfLines={1}
        flexShrink={1}
      >
        {people.join(", ")}
      </Text>
    </Row>
  );
}

/** The Proxy payments tab as the app has it today. */
function ProxyPaymentsContent() {
  return (
    <>
      <Stack gap="$sm">
        <Text variant="heading" role="heading">
          A friend pays the transfer. You pay them in bitcoin.
        </Text>
        <Text color="$colorMuted">
          Scan the QR code of a bank transfer. A few of your friends get the
          offer, the first to accept pays it from their bank, and you send them
          sats.
        </Text>
      </Stack>
      <Row gap="$sm">
        <Button
          icon="ScanLine"
          flex={1}
          flexDirection="column"
          paddingVertical="$xl"
          onPress={noop}
        >
          Scan QR
        </Button>
        <Button
          icon="PencilLine"
          variant="secondary"
          flex={1}
          flexDirection="column"
          paddingVertical="$xl"
          onPress={noop}
        >
          Enter manually
        </Button>
      </Row>
      <Stack gap="$sm">
        <Text variant="title" role="heading">
          Who can pay for you
        </Text>
        {payers.map(({ currency, people }) => (
          <PayerRow key={currency} currency={currency} people={people} />
        ))}
      </Stack>
      <Divider />
      <Stack gap="$sm">
        <Text variant="title" role="heading">
          Earn bitcoin
        </Text>
        <Text color="$colorMuted">
          Pay a friend's bank transfer and get sats for it. Each offer arrives
          as a notification, so notifications stay on.
        </Text>
        {earnRows.map(({ currency, label, on }) => (
          <ListRow
            key={currency}
            leading={
              <Stack minWidth="$control">
                <Pill label={currency} size="sm" />
              </Stack>
            }
            title={label}
            trailing={
              <Switch
                accessibilityLabel={label}
                value={on}
                onValueChange={noop}
              />
            }
          />
        ))}
        <Text variant="label" color="$accentText">
          Your contacts can now send you offers.
        </Text>
      </Stack>
    </>
  );
}

/** The Nearby section the beacon adds at the end of the Proxy payments tab. */
function NearbySection({
  state,
  trade,
  tap,
}: {
  state: BeaconState;
  trade?: Trade | undefined;
  tap?: "switch" | "sell" | "allow" | undefined;
}) {
  const on = state === "on";
  return (
    <Stack gap="$sm">
      <Text variant="title" role="heading">
        Nearby
      </Text>
      <Text color="$colorMuted">
        Contacts who also saved you see when you are near, and whether you buy
        or sell bitcoin. Only while this is on.
      </Text>
      <ListRow
        icon="Radio"
        title="Beacon"
        trailing={
          <Tapped on={tap === "switch"}>
            <Switch
              accessibilityLabel="Beacon"
              value={on || state === "asking"}
              onValueChange={noop}
            />
          </Tapped>
        }
      />
      <Text variant="label" fontWeight="$regular" color="$colorMuted">
        Mutual contacts near you see that you are here. Linky uses Bluetooth in
        the background while this is on. While Linky is open, anyone nearby can
        also see your npub so they can add you. In the background nobody else
        can tell your phone runs Linky.
      </Text>
      {state === "denied" ? (
        <Notice
          tone="warning"
          title="Bluetooth permission needed"
          description="Allow Nearby devices so Linky can broadcast and scan."
          action={{ label: "Allow", onPress: noop }}
        />
      ) : null}
      {on ? (
        <Notice
          tone="accent"
          icon="Radio"
          title="Beacon is on"
          description="Broadcasting to 14 mutual contacts. 3 nearby now."
        />
      ) : null}
      <Section title="Trade">
        <Text variant="label" fontWeight="$regular" color="$colorMuted">
          Nearby contacts see whether you buy or sell bitcoin. No amount.
        </Text>
        <Stack position="relative">
          <SegmentedControl
            accessibilityLabel="Trade"
            value={trade ?? "none"}
            onValueChange={noop}
            options={tradeOptions.map(({ value, label }) => ({
              value,
              label,
              disabled: !on,
            }))}
          />
          {/* The segments take no children, so the touch sits on a matching row above them. */}
          {tap === "sell" ? (
            <Row
              position="absolute"
              top="$none"
              bottom="$none"
              left="$none"
              right="$none"
              pointerEvents="none"
            >
              {tradeOptions.map(({ value }) => (
                <Tapped key={value} on={value === "sell"} flex={1} />
              ))}
            </Row>
          ) : null}
        </Stack>
      </Section>
    </Stack>
  );
}

/** The Proxy payments tab scrolled to its end, where the Nearby section holds the beacon switch and the trade. */
export function ProxyPaymentsScreen({
  state,
  trade,
  tap,
}: {
  state: BeaconState;
  trade?: Trade | undefined;
  tap?: "switch" | "sell" | "allow" | undefined;
}) {
  return (
    <>
      <AppTopBar title="Proxy payments" />
      <AppBody gap="$xxxl" justifyContent="flex-end" paddingBottom="$xl">
        <ProxyPaymentsContent />
        <Divider />
        <NearbySection state={state} trade={trade} tap={tap} />
      </AppBody>
      <AppTabBar active="proxy" me="Dave" />
      {state === "asking" ? (
        <PermissionDialog tapAllow={tap === "allow"} />
      ) : null}
    </>
  );
}

interface Conversation {
  person: Person;
  preview: string;
  time: string;
  outgoing?: boolean;
  unread?: boolean;
}

const conversations: Conversation[] = [
  {
    person: "Ben Ellis",
    preview: "I'll bring the board games",
    time: "05:57 PM",
    unread: true,
  },
  {
    person: "Mia Novak",
    preview: "Are you at the meetup already?",
    time: "05:41 PM",
    unread: true,
  },
  {
    person: "Jan Kral",
    preview: "Thanks for the coffee",
    time: "04:12 PM",
    outgoing: true,
  },
  {
    person: "Sofia Lane",
    preview: "See you at the farmers' market",
    time: "02:30 PM",
    outgoing: true,
  },
  { person: "Mom", preview: "Call me when you get home", time: "11:05 AM" },
  { person: "Lena Fox", preview: "Saved you a seat", time: "Oct 2" },
  { person: "Tomas Berg", preview: "Climbing on Thursday?", time: "Oct 1" },
  { person: "Alex Rivers", preview: "Paid, thanks!", time: "Sep 29" },
];

function Contact({ person, preview, time, outgoing, unread }: Conversation) {
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

/** The contacts page with the stories row above today's contact sections. */
export function ContactsScreen({
  me,
  myTrade,
  nearby,
  tapped,
  overlay,
}: {
  me: Person;
  myTrade?: Trade | undefined;
  nearby: readonly NearbyContact[];
  tapped?: Person | undefined;
  overlay?: ReactNode;
}) {
  return (
    <>
      <AppTopBar title="Contacts" trailing="Filter" />
      <AppBody position="relative" gap="$xs">
        {myTrade || nearby.length > 0 ? (
          <Section title="Nearby">
            <StoriesRow
              me={me}
              myTrade={myTrade}
              nearby={nearby}
              tapped={tapped}
            />
          </Section>
        ) : null}
        <Section title="Proxy payments">
          <Contact
            person="Eva Stone"
            preview="Thanks for the playlist"
            time="06:12 PM"
          />
        </Section>
        <Section title="Conversations">
          <Stack gap="$xs">
            {conversations
              .filter(({ person }) => person !== me)
              .map((conversation) => (
                <Contact key={conversation.person} {...conversation} />
              ))}
          </Stack>
        </Section>
        <Stack position="absolute" right="$xl" bottom="$xl">
          <IconButton
            icon="UserPlus"
            variant="primary"
            size="lg"
            accessibilityLabel="Add contact"
            onPress={noop}
          />
        </Stack>
        {overlay ? (
          <Stack position="absolute" top="$none" left="$md" right="$md">
            {overlay}
          </Stack>
        ) : null}
      </AppBody>
      <AppTabBar active="contacts" me={me} />
    </>
  );
}

export interface ChatLine {
  text: string;
  time: string;
  outgoing?: boolean;
}

function Message({ text, time, outgoing = false }: ChatLine) {
  return (
    <MessageBubble
      direction={outgoing ? "outgoing" : "incoming"}
      footer={
        <Text variant="caption" color="$colorMuted">
          {time}
        </Text>
      }
    >
      {outgoing ? (
        <Row alignItems="flex-end" gap="$sm">
          <Stack flexShrink={1}>
            <Text>{text}</Text>
          </Stack>
          <Icon name="CheckCheck" size="sm" color="$accent" />
        </Row>
      ) : (
        <Text>{text}</Text>
      )}
    </MessageBubble>
  );
}

/** A conversation, with the nearby banner while the contact is nearby. */
export function ChatScreen({
  contact,
  nearby,
  trade,
  messages,
}: {
  contact: Person;
  nearby: boolean;
  trade?: Trade | undefined;
  messages: readonly ChatLine[];
}) {
  return (
    <>
      <AppTopBar contact={contact} leading="ChevronLeft" trailing="Pencil" />
      {nearby ? <NearbyBanner trade={trade} /> : null}
      <AppBody gap="$sm" paddingTop="$sm" justifyContent="flex-end">
        {messages.length > 0 ? <DaySeparator label="Today" /> : null}
        {messages.map((line) => (
          <Message key={line.text} {...line} />
        ))}
      </AppBody>
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

export interface Candidate {
  name: string;
  npub: string;
  uri?: string | undefined;
  /** Shown instead of the npub, e.g. a lightning address. */
  detail?: string;
}

function CandidateRow({
  candidate,
  tapped,
}: {
  candidate: Candidate;
  tapped: boolean;
}) {
  return (
    <ListRow
      leading={<Avatar name={candidate.name} uri={candidate.uri} />}
      title={
        <Text fontWeight="$semibold" numberOfLines={1}>
          {candidate.name}
        </Text>
      }
      description={candidate.detail ?? candidate.npub}
      trailing={
        <Tapped on={tapped}>
          <Button icon="UserPlus" onPress={noop}>
            Add
          </Button>
        </Tapped>
      }
    />
  );
}

/** The add-contact page with the Nearby section above New Linky users. */
export function AddContactScreen({
  nearby,
  suggestions,
  tapped,
}: {
  nearby: readonly Candidate[];
  suggestions: readonly Candidate[];
  tapped?: string | undefined;
}) {
  return (
    <>
      <AppTopBar title="Add new contact" leading="ChevronLeft" />
      <AppBody paddingTop="$md" paddingBottom="$huge">
        <TextField
          label="Contact"
          hint="Enter an npub, NIP-05, or reserved name, for example alice."
          placeholder="npub, NIP-05, or reserved name"
          trailing={
            <IconButton
              icon="ClipboardPaste"
              size="sm"
              accessibilityLabel="Paste"
              onPress={noop}
            />
          }
        />
        <Stack flex={1} justifyContent="flex-end" gap="$lg">
          <Section title="Nearby">
            {nearby.map((candidate) => (
              <CandidateRow
                key={candidate.npub}
                candidate={candidate}
                tapped={tapped === candidate.name}
              />
            ))}
          </Section>
          <Section title="New Linky users">
            {suggestions.map((candidate) => (
              <CandidateRow
                key={candidate.npub}
                candidate={candidate}
                tapped={false}
              />
            ))}
          </Section>
        </Stack>
      </AppBody>
    </>
  );
}

/** Android's pulled-down notification shade. */
export function NotificationShadeScreen({ children }: { children: ReactNode }) {
  return (
    <Stack flex={1} paddingHorizontal="$md" paddingTop="$xl" gap="$md">
      <Stack paddingHorizontal="$md" paddingBottom="$md">
        <Text variant="display" color="$colorStrong">
          9:41
        </Text>
        <Text variant="label" color="$colorMuted">
          Thursday, October 8
        </Text>
      </Stack>
      {children}
    </Stack>
  );
}

export function BeaconOnNotification() {
  return (
    <AndroidNotification
      ongoing
      title="Beacon is on"
      text="Mutual contacts nearby can see you."
      actions={["Turn off"]}
    />
  );
}

export function TradeNotification({
  person,
  trade,
}: {
  person: Person;
  trade: Trade;
}) {
  return (
    <AndroidNotification
      person={person}
      title={person}
      text={`${person.split(" ")[0] ?? person} is nearby and ${tradeLabel(trade).toLowerCase()}`}
      actions={["Open chat"]}
    />
  );
}
