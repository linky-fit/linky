import { useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityRow,
  Amount,
  AmountField,
  AttachmentCard,
  AttachmentTray,
  Avatar,
  BottomNav,
  Button,
  Chip,
  ContactRow,
  ConversationHeader,
  DateGroup,
  Dialog,
  Divider,
  EmptyState,
  Icon,
  IconButton,
  LoadingState,
  ListRow,
  MessageActions,
  MessageBubble,
  MessageComposer,
  ChatPaymentAction,
  Notice,
  PaymentMessage,
  PaymentResult,
  PersonShortcut,
  QRCodeCard,
  Reaction,
  ReplyPreview,
  Row,
  ScreenHeader,
  SearchField,
  SectionHeader,
  SegmentedControl,
  SelectField,
  Stack,
  StatusBadge,
  Surface,
  Text,
  TextField,
  Toast,
  UnreadBadge,
  WalletBalance,
  icons,
  palette,
  themes,
  typography,
  space,
  radius,
  motion,
  zIndex,
  breakpoints,
  size,
} from "@linky/ui";
import type {
  AttachmentDraft,
  IconName,
  PaymentState,
  TextProps,
  Tone,
} from "@linky/ui";
import { navigation, people, sampleAttachment } from "./fixtures";

export interface ExampleProps {
  notify: (message: string) => void;
}
export function WalletExample({ notify }: ExampleProps) {
  const [tab, setTab] = useState("wallet");
  const [receive, setReceive] = useState(false);
  return (
    <Stack gap={0}>
      <ScreenHeader
        title={tab === "wallet" ? "Wallet" : "People"}
        leading={<Avatar name="Dave" uri="/avatars/profile.png" size="small" />}
        trailing={
          <IconButton
            label="Wallet settings"
            icon="Menu"
            onPress={() => notify("Settings action selected")}
          />
        }
      />
      <Stack padding="$page" paddingTop="$md" gap="$page">
        {tab === "wallet" ? (
          <>
            <WalletBalance
              label="Available balance"
              value="84,250"
              unit="sats"
              receiveLabel="Receive"
              sendLabel="Send"
              onReceive={() => setReceive(true)}
              onSend={() =>
                notify(
                  "Send action selected. Explore payment states in Payments.",
                )
              }
            />
            <Stack gap="$lg">
              <SectionHeader
                title="People"
                action={{
                  label: "All contacts",
                  onPress: () => setTab("people"),
                }}
              />
              <Row gap={23}>
                {people.map((person) => (
                  <PersonShortcut
                    key={person.name}
                    name={person.name}
                    uri={person.uri}
                    label={person.name.split(" ")[0] ?? person.name}
                    onPress={() => notify(`Selected ${person.name}`)}
                  />
                ))}
              </Row>
            </Stack>
            <Stack gap="$xs">
              <SectionHeader
                title="Activity"
                action={{
                  label: "View all",
                  onPress: () => notify("Showing all sample activity"),
                }}
              />
              <DateGroup label="Today">
                <ActivityRow
                  name="Anna Novak"
                  uri="/avatars/anna.png"
                  description="Dinner"
                  amount="−2,400"
                  unit="sats"
                  state="completed"
                  statusLabel="Paid"
                  onPress={() =>
                    notify("Sample dinner payment: 2,400 sats, completed")
                  }
                />
                <ActivityRow
                  name="Tomas Svoboda"
                  uri="/avatars/tomas.png"
                  description="Received"
                  amount="+10,000"
                  unit="sats"
                  state="completed"
                  statusLabel="Received"
                />
              </DateGroup>
              <DateGroup label="Yesterday">
                <ActivityRow
                  name="Klara"
                  uri="/avatars/klara.png"
                  description="Coffee"
                  amount="−650"
                  unit="sats"
                  state="pending"
                  statusLabel="Pending"
                />
              </DateGroup>
            </Stack>
          </>
        ) : (
          <>
            {people.map((person) => (
              <ContactRow
                key={person.name}
                {...person}
                onPress={() => notify(`Open conversation with ${person.name}`)}
              />
            ))}
          </>
        )}
        <Stack alignItems="center" paddingTop="$lg">
          <BottomNav
            label="Wallet preview navigation"
            items={navigation}
            value={tab}
            onValueChange={setTab}
          />
        </Stack>
      </Stack>
      <Dialog
        open={receive}
        onOpenChange={setReceive}
        title="Receive sats"
        description="Illustrative QR code. This encodes sample text, not a payment request."
        closeLabel="Close receive"
      >
        <QRCodeCard
          value="linky-ui:sample-receive"
          label="Sample receive QR code"
          caption="Demo only · no funds can be received"
        />
      </Dialog>
    </Stack>
  );
}
export function ChatExample({ notify }: ExampleProps) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [reply, setReply] = useState(false);
  const [liked, setLiked] = useState(false);
  return (
    <Stack gap={0}>
      <ConversationHeader
        name="Anna Novak"
        uri="/avatars/anna.png"
        subtitle="Friends"
        backLabel="Back to conversations"
        onBack={() => notify("Back action selected")}
        actions={
          <IconButton
            label="Conversation details"
            icon="MoreHorizontal"
            onPress={() => notify("Anna Novak · sample contact")}
          />
        }
      />
      <Stack padding="$page" gap="$lg">
        <Text variant="caption" muted textAlign="center">
          Today
        </Text>
        <MessageBubble
          direction="incoming"
          time="12:40"
          reactions={
            <Reaction
              label="Heart"
              count={liked ? 2 : 1}
              selected={liked}
              onPress={() => setLiked(!liked)}
            />
          }
          actions={
            <MessageActions
              label="Dinner message actions"
              replyLabel="Reply to dinner message"
              reactLabel="Like dinner message"
              onReply={() => setReply(true)}
              onReact={() => setLiked(!liked)}
            />
          }
        >
          Hey! Thanks for dinner yesterday. It was so nice to catch up.
        </MessageBubble>
        <MessageBubble direction="outgoing" time="12:41" status="Read">
          Absolutely! Let’s do it again soon.
        </MessageBubble>
        <PaymentMessage
          direction="outgoing"
          state="completed"
          label="You sent"
          amount="1,250"
          unit="sats"
          note="Dinner yesterday"
          statusLabel="Paid"
          time="12:42"
        />
        <MessageBubble direction="incoming" time="12:42">
          Thanks for dinner! See you soon.
        </MessageBubble>
        {messages.map((message, index) => (
          <MessageBubble
            key={`${index}-${message}`}
            direction="outgoing"
            time="Now"
            status="Local preview"
          >
            {message}
          </MessageBubble>
        ))}
        <MessageComposer
          label="Chat message"
          placeholder="Message"
          value={draft}
          onChangeText={setDraft}
          sendLabel="Send chat message"
          canSend={draft.trim().length > 0 || attachments.length > 0}
          onSend={() => {
            setMessages([
              ...messages,
              draft.trim() || "Dinner receipt.pdf · sample attachment",
            ]);
            setDraft("");
            setAttachments([]);
            setReply(false);
          }}
          attachmentAction={{
            label: "Attach sample receipt",
            onPress: () => setAttachments([sampleAttachment]),
          }}
          attachments={
            <AttachmentTray
              items={attachments}
              onRemove={(id) =>
                setAttachments(attachments.filter((item) => item.id !== id))
              }
            />
          }
          reply={
            reply ? (
              <ReplyPreview
                author="Anna Novak"
                body="Hey! Thanks for dinner yesterday."
                dismissLabel="Cancel reply"
                onDismiss={() => setReply(false)}
              />
            ) : null
          }
          paymentActions={
            <>
              <ChatPaymentAction
                kind="request"
                onPress={() => notify("Request sats action selected")}
              >
                Request
              </ChatPaymentAction>
              <ChatPaymentAction
                kind="pay"
                onPress={() => notify("Send sats action selected")}
              >
                Pay Anna
              </ChatPaymentAction>
            </>
          }
          caption="Sample conversation · no messages leave this device"
        />
      </Stack>
    </Stack>
  );
}
export function Foundations() {
  const variants: TextProps["variant"][] = [
    "display",
    "heading",
    "title",
    "body",
    "label",
    "caption",
    "amount",
    "message",
    "metadata",
  ];
  const iconNames = Object.keys(icons).filter(
    (name): name is IconName => name in icons,
  );
  return (
    <Stack>
      {variants.map((variant) => (
        <Row key={variant} justifyContent="space-between" flexWrap="wrap">
          <Text variant={variant}>
            {variant === "amount" ? "84,250" : `Linky ${variant}`}
          </Text>
          <Text variant="caption" muted>
            {variant}
          </Text>
        </Row>
      ))}
      <Divider />
      <Surface>
        <Text>Surface</Text>
        <Row>
          <Text>Row</Text>
          <Text muted>Aligned content</Text>
        </Row>
        <Stack>
          <Text>Stack</Text>
          <Text muted>Vertical content</Text>
        </Stack>
      </Surface>
      <SectionHeader title="Icon inventory" />
      <div className="icon-grid">
        {iconNames.map((name) => (
          <Stack key={name} alignItems="center" gap="$sm">
            <Icon name={name} />
            <Text variant="caption" muted>
              {name}
            </Text>
          </Stack>
        ))}
      </div>
      <SectionHeader title="Palette" />
      <div className="token-grid">
        {Object.entries(palette).map(([name, color]) => (
          <div key={name}>
            <div className="token-swatch" style={{ backgroundColor: color }} />
            <Text variant="caption">{name}</Text>
            <Text variant="caption" muted>
              {color}
            </Text>
          </div>
        ))}
      </div>
      <details>
        <summary>Exported design tokens</summary>
        <pre>
          {JSON.stringify(
            {
              typography,
              space,
              radius,
              size,
              motion,
              zIndex,
              breakpoints,
              themes,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </Stack>
  );
}
export function Controls({ notify }: ExampleProps) {
  const [filter, setFilter] = useState("All");
  const [segment, setSegment] = useState("personal");
  return (
    <Stack>
      <Row flexWrap="wrap">
        {["primary", "secondary", "ghost", "danger"].map((variant) => {
          if (
            variant !== "primary" &&
            variant !== "secondary" &&
            variant !== "ghost" &&
            variant !== "danger"
          )
            return null;
          return (
            <Button
              key={variant}
              variant={variant}
              onPress={() => notify(`${variant} button pressed`)}
            >
              {variant}
            </Button>
          );
        })}
      </Row>
      <Row flexWrap="wrap">
        <Button icon="Plus" onPress={() => notify("Add action selected")}>
          Add contact
        </Button>
        <Button
          size="small"
          variant="secondary"
          onPress={() => notify("Compact button pressed")}
        >
          Compact
        </Button>
        <Button disabled>Disabled</Button>
        <Button loading loadingLabel="Sending">
          Send
        </Button>
        <IconButton
          label="Add item"
          icon="Plus"
          onPress={() => notify("Icon button pressed")}
        />
      </Row>
      <Row flexWrap="wrap">
        {["All", "Friends", "Work"].map((label) => (
          <Chip
            key={label}
            selected={filter === label}
            onPress={() => setFilter(label)}
          >
            {label}
          </Chip>
        ))}
        <Chip disabled onPress={() => {}}>
          Disabled filter
        </Chip>
      </Row>
      <SegmentedControl
        label="Account type"
        value={segment}
        onValueChange={setSegment}
        options={[
          { value: "personal", label: "Personal" },
          { value: "work", label: "Work" },
          { value: "shared", label: "Shared", disabled: true },
        ]}
      />
    </Stack>
  );
}
export function Fields() {
  const [name, setName] = useState("Anna Novak");
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState("1250");
  const [group, setGroup] = useState("friends");
  return (
    <Stack>
      <TextField
        label="Contact name"
        value={name}
        onChangeText={setName}
        hint="Use a name you’ll recognize."
      />
      <TextField
        label="Contact address"
        value="invalid-address"
        error="Enter a valid Nostr address."
        onChangeText={() => {}}
      />
      <TextField label="Disabled input" value="Read-only example" disabled />
      <TextField
        label="Note"
        defaultValue="Dinner yesterday. Thanks for organizing!"
        multiline
        minHeight={96}
      />
      <SearchField
        label="Search people"
        clearLabel="Clear people search"
        value={search}
        onChangeText={setSearch}
      />
      <Text variant="caption" muted>
        {search ? `Searching for “${search}”` : "Search is empty"}
      </Text>
      <SelectField
        label="Contact group"
        description="Choose a group for this sample contact."
        closeLabel="Close group selection"
        value={group}
        onValueChange={setGroup}
        options={[
          { value: "friends", label: "Friends" },
          { value: "family", label: "Family" },
          { value: "work", label: "Work" },
          { value: "archived", label: "Archived", disabled: true },
        ]}
      />
      <AmountField
        label="Amount to send"
        value={amount}
        unit="sats"
        onChangeText={setAmount}
        hint="Available: 84,250 sats · sample balance"
      />
      <AmountField
        label="Amount with error"
        value="100000"
        unit="sats"
        onChangeText={() => {}}
        error="Amount exceeds your available balance."
      />
    </Stack>
  );
}
export function People({ notify }: ExampleProps) {
  return (
    <Stack>
      <Row flexWrap="wrap">
        <Avatar
          name="Dave"
          uri="/avatars/profile.png"
          size="large"
          label="Dave's sample portrait"
        />
        <Avatar name="Anna Novak" uri="/avatars/anna.png" />
        <Avatar name="Eva Novak" />
        <Avatar name="" size="small" />
        <UnreadBadge count={3} label="3 unread messages" />
        <UnreadBadge count={120} label="120 unread messages" />
      </Row>
      <Row flexWrap="wrap">
        {people.map((person) => (
          <PersonShortcut
            key={person.name}
            {...person}
            onPress={() => notify(`Selected ${person.name}`)}
          />
        ))}
      </Row>
      <Stack gap={0}>
        {people.map((person, index) => (
          <ContactRow
            key={person.name}
            {...person}
            unreadCount={index === 1 ? 2 : 0}
            unreadLabel="2 unread messages"
            onPress={() => notify(`Selected ${person.name}`)}
          />
        ))}
        <ContactRow
          name="Alexandra Montgomery-Wellington"
          preview="A very long message preview to check truncation on smaller screens and large text sizes."
          time="Yesterday"
          unreadCount={104}
          unreadLabel="104 unread messages"
          onPress={() => notify("Selected long-name example")}
        />
      </Stack>
      <ListRow
        title="Security"
        description="Your keys stay on your device."
        leading={<Icon name="ShieldCheck" />}
        trailing={<Icon name="ChevronRight" />}
        onPress={() => notify("Security row selected")}
      />
      <Divider />
      <ListRow
        title="Version"
        description="UI next preview"
        trailing={<Text muted>0.1.0</Text>}
      />
    </Stack>
  );
}
export function Messaging({ notify }: ExampleProps) {
  return (
    <Stack>
      <ChatExample notify={notify} />
      <Divider />
      <MessageBubble direction="outgoing" time="Now" status="Sending">
        This message shows the sending state.
      </MessageBubble>
      <MessageBubble
        direction="incoming"
        reply={
          <ReplyPreview
            author="You"
            body="A quoted message with enough text to span more than one line when the preview is narrow."
          />
        }
      >
        A reply keeps the earlier message in context.
      </MessageBubble>
      <MessageComposer
        value="Disabled draft"
        onChangeText={() => {}}
        onSend={() => notify("Should never send")}
        label="Disabled message"
        sendLabel="Send disabled message"
        disabled
      />
      <MessageComposer
        value="Sending draft"
        onChangeText={() => {}}
        onSend={() => notify("Should never send")}
        label="Sending message"
        sendLabel="Send busy message"
        sending
      />
    </Stack>
  );
}
export function Attachments({ notify }: ExampleProps) {
  const [items, setItems] = useState<AttachmentDraft[]>([
    sampleAttachment,
    {
      id: "portrait",
      name: "Anna portrait.png",
      previewUri: "/avatars/anna.png",
      removeLabel: "Remove portrait",
    },
  ]);
  return (
    <Stack>
      <AttachmentCard
        name="Dinner receipt.pdf"
        description="PDF · 42 KB · sample file"
        label="Preview receipt"
        onPress={() => notify("Sample receipt preview selected")}
      />
      <AttachmentCard
        name="Anna portrait.png"
        description="PNG · demo portrait"
        previewUri="/avatars/anna.png"
        label="Preview portrait"
        onPress={() => notify("Sample portrait preview selected")}
      />
      <AttachmentTray
        items={items}
        onRemove={(id) => setItems(items.filter((item) => item.id !== id))}
      />
      <Button variant="secondary" onPress={() => setItems([sampleAttachment])}>
        Reset attachments
      </Button>
    </Stack>
  );
}
export function Navigation({ notify }: ExampleProps) {
  const [tab, setTab] = useState("wallet");
  return (
    <Stack>
      <ScreenHeader
        title="Payment details"
        back={{ label: "Go back", onPress: () => notify("Back selected") }}
        trailing={
          <IconButton
            icon="MoreHorizontal"
            label="More details"
            onPress={() => notify("More selected")}
          />
        }
      />
      <ConversationHeader
        name="Anna Novak"
        uri="/avatars/anna.png"
        subtitle="Friends"
        backLabel="Back"
        onBack={() => notify("Back selected")}
      />
      <BottomNav
        label="Navigation example"
        items={navigation}
        value={tab}
        onValueChange={setTab}
      />
      <Text muted>Selected: {tab}</Text>
    </Stack>
  );
}
export function Feedback({ notify }: ExampleProps) {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(true);
  const tones: Tone[] = ["neutral", "success", "warning", "danger", "info"];
  return (
    <Stack>
      <Row flexWrap="wrap">
        {tones.map((tone) => (
          <StatusBadge key={tone} label={tone} tone={tone} />
        ))}
      </Row>
      <Notice
        title="You're offline"
        description="Messages will send when you reconnect."
        tone="warning"
        icon="WifiOff"
      />
      <Notice
        title="Payment failed"
        description="Your balance is unchanged. Try again."
        tone="danger"
      />
      <Notice
        title="Contact added"
        description="You can start a conversation."
        tone="success"
      />
      <Notice
        title="Demo data"
        description="All people, messages, and payments in this book are examples."
        tone="info"
      />
      <LoadingState label="Loading sample activity…" />
      <EmptyState
        title="No conversations yet"
        description="Add someone to start a conversation."
        icon="MessageCircle"
        action={
          <Button onPress={() => notify("Add contact selected")}>
            Add contact
          </Button>
        }
      />
      {toast ? (
        <Toast
          message="Sample contact saved"
          dismissLabel="Dismiss example toast"
          onDismiss={() => setToast(false)}
        />
      ) : (
        <Button variant="secondary" onPress={() => setToast(true)}>
          Show toast
        </Button>
      )}
      <Button onPress={() => setOpen(true)}>Open example dialog</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Add a contact"
        description="Try keyboard navigation, Escape, and returning focus to the opener."
        closeLabel="Close example dialog"
      >
        <TextField label="Dialog contact name" placeholder="Name" />
        <Button
          onPress={() => {
            setOpen(false);
            notify("Sample contact saved");
          }}
        >
          Save sample contact
        </Button>
      </Dialog>
    </Stack>
  );
}
export function Payments() {
  const [state, setState] = useState<PaymentState>("completed");
  const [requestPaid, setRequestPaid] = useState(false);
  const titles = {
    completed: "Payment complete",
    pending: "Payment pending",
    failed: "Payment failed",
  };
  const descriptions = {
    completed: "Anna received your sample payment.",
    pending: "Waiting for the sample payment to complete.",
    failed: "Your sample balance is unchanged. You can try again.",
  };
  return (
    <Stack>
      <SegmentedControl
        label="Payment outcome"
        value={state}
        onValueChange={(value) => {
          if (
            value === "completed" ||
            value === "pending" ||
            value === "failed"
          )
            setState(value);
        }}
        options={[
          { value: "completed", label: "Completed" },
          { value: "pending", label: "Pending" },
          { value: "failed", label: "Failed" },
        ]}
      />
      <PaymentResult
        state={state}
        title={titles[state]}
        description={descriptions[state]}
        amount="1,250"
        unit="sats"
        caption="Illustrative payment · no funds move"
        action={
          state === "failed" ? (
            <Button onPress={() => setState("pending")}>
              Try sample again
            </Button>
          ) : undefined
        }
      />
      <Divider />
      <PaymentMessage
        direction="outgoing"
        state={state}
        label="You sent"
        amount="1,250"
        unit="sats"
        statusLabel={titles[state]}
        note="Dinner yesterday"
      />
      <PaymentMessage
        direction="incoming"
        kind="request"
        state={requestPaid ? "completed" : "pending"}
        label="Anna requested"
        amount="500"
        unit="sats"
        statusLabel={requestPaid ? "Request paid" : "Awaiting payment"}
        actions={
          requestPaid ? null : (
            <Button size="small" onPress={() => setRequestPaid(true)}>
              Pay sample request
            </Button>
          )
        }
      />
      <ActivityRow
        name="Anna Novak"
        uri="/avatars/anna.png"
        description="Dinner yesterday"
        amount="−1,250"
        unit="sats"
        state={state}
        statusLabel={titles[state]}
      />
      <Row justifyContent="space-around" flexWrap="wrap">
        <Amount value="0" unit="sats" />
        <Amount value="21,000,000" unit="BTC" size="payment" />
      </Row>
      <QRCodeCard
        value="linky-ui:sample-receive"
        label="Sample QR code"
        caption="Encodes sample text, not a payable request"
      >
        <Text variant="caption" muted>
          linky-ui:sample-receive
        </Text>
      </QRCodeCard>
    </Stack>
  );
}
export function ExampleFrame({ children }: { children: ReactNode }) {
  return <div className="example-frame">{children}</div>;
}
