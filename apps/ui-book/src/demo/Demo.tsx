import { useEffect, useReducer, useRef, useState } from "react";
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { getDocumentAsync } from "expo-document-picker";
import { setStringAsync } from "expo-clipboard";
import {
  ActivityRow,
  AmountField,
  AttachmentCard,
  AttachmentTray,
  Avatar,
  BottomNav,
  Button,
  ChatPaymentAction,
  Chip,
  ContactRow,
  ConversationHeader,
  DateGroup,
  EmptyState,
  Icon,
  IconButton,
  MessageActions,
  MessageBubble,
  MessageComposer,
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
  Stack,
  Text,
  TextField,
  Toast,
  UIProvider,
  WalletBalance,
  themes,
} from "@linky/ui";
import type { ColorMode, NavItem } from "@linky/ui";
import { portraits } from "../assets";
import { demoReducer, formatSats, initialState, paymentError } from "./model";
import type { Attachment, Contact, Message, Transaction } from "./model";
import { DemoDialogs } from "./dialogs";
import type { DemoDialog } from "./dialogs";

const pages = [
  "wallet",
  "contacts",
  "chat",
  "pay",
  "request",
  "result",
  "receive",
  "scan",
  "history",
  "profile",
];
const navigation: NavItem[] = [
  { value: "contacts", label: "Contacts", icon: "Users" },
  { value: "wallet", label: "Wallet", icon: "Wallet" },
];
const time = () =>
  new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
let sequence = 0;
const id = () => `demo-${++sequence}`;
const statusLabel = (status: Transaction["status"]) =>
  ({ completed: "Completed", pending: "Pending", failed: "Failed" })[status];
const digits = (value: string) => value.replace(/[^0-9]/g, "").slice(0, 12);

export interface DemoProps {
  route: string;
  navigate: (route: string) => void;
}

export function Demo({ route, navigate }: DemoProps) {
  const routePage = route.split("#")[1] ?? "wallet";

  const [state, dispatch] = useReducer(demoReducer, initialState);
  const [selectedId, setSelectedId] = useState("anna");
  const [dialog, setDialog] = useState<DemoDialog>(null);
  const [mode, setMode] = useState<ColorMode>("dark");
  const [unit, setUnit] = useState("sats");
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("All");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [staged, setStaged] = useState<Attachment[]>([]);
  const [reply, setReply] = useState("");
  const [attachment, setAttachment] = useState<Attachment>();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [resultId, setResultId] = useState("");
  const [requestResult, setRequestResult] = useState(false);
  const page =
    pages.includes(routePage) && (routePage !== "result" || resultId)
      ? routePage
      : "wallet";
  const [detailId, setDetailId] = useState("");
  const [offline, setOffline] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const [toast, setToast] = useState("");
  const [receiveAmount, setReceiveAmount] = useState("1000");
  const [received, setReceived] = useState(false);
  const content = useRef<ScrollView>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const submitLock = useRef(false);
  const attachmentSession = useRef(0);
  const { width } = useWindowDimensions();
  const wide = width >= 960;
  const colors = themes[mode];
  const contact = state.contacts.find((person) => person.id === selectedId);
  const transaction = state.transactions.find((item) => item.id === detailId);
  const result = state.transactions.find((item) => item.id === resultId);
  const messages = state.messages[selectedId] ?? [];
  const draft = drafts[selectedId] ?? "";
  const request = `linky-design:sample-request:${receiveAmount || "0"}`;

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      attachmentSession.current++;
    },
    [],
  );
  useEffect(() => {
    if (page === "pay" || page === "request") submitLock.current = false;
  }, [page]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (page === "chat") content.current?.scrollToEnd({ animated: false });
    else content.current?.scrollTo({ y: 0, animated: false });
  }, [page, messages.length]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (dialog) return false;
        navigate(page === "wallet" ? "/" : "/demo");
        return true;
      },
    );
    return () => subscription.remove();
  }, [dialog, navigate, page]);

  function go(next: string) {
    setError("");
    navigate(next === "wallet" ? "/demo" : `/demo#${next}`);
  }
  function openChat(person: Contact) {
    attachmentSession.current++;
    setSelectedId(person.id);
    dispatch({ type: "read", contactId: person.id });
    setReply("");
    setStaged([]);
    go("chat");
  }
  function beginPayment(
    kind: "pay" | "request",
    person = contact,
    sample = false,
  ) {
    if (!person) return;
    setSelectedId(person.id);
    setAmount(sample ? "2400" : "");
    setNote(sample ? "Dinner" : "");
    submitLock.current = false;
    go(kind);
  }
  function reset() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    attachmentSession.current++;
    dispatch({ type: "reset" });
    setOffline(false);
    setFailNext(false);
    setDrafts({});
    setStaged([]);
    setReply("");
    setSearch("");
    setGroup("All");
    setDialog(null);
    setResultId("");
    setDetailId("");
    setReceived(false);
    submitLock.current = false;
    go("wallet");
    setToast("Sample data reset");
  }
  async function copy(value: string) {
    try {
      const copied = await setStringAsync(value);
      setToast(
        copied
          ? "Copied to clipboard"
          : "Copy unavailable. Select the text to copy it.",
      );
    } catch {
      setToast("Copy unavailable. Select the text to copy it.");
    }
  }
  async function share() {
    try {
      await Share.share({
        message: `Sample Linky request: ${receiveAmount} sats. No real funds. ${request}`,
      });
    } catch {
      setToast("Sharing unavailable. Use Copy to share the sample request.");
    }
  }
  async function attach() {
    const session = attachmentSession.current;
    try {
      const picked = await getDocumentAsync({
        type: ["image/*", "application/pdf"],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (picked.canceled || session !== attachmentSession.current) return;
      const accepted: Attachment[] = [];
      for (const file of picked.assets) {
        const image = file.mimeType?.startsWith("image/");
        if (!image && file.mimeType !== "application/pdf") {
          setError("Choose an image or a PDF.");
          continue;
        }
        if ((file.size ?? 0) > (image ? 20 : 2) * 1024 * 1024) {
          setError(
            image
              ? "Choose an image smaller than 20 MB."
              : "Choose a PDF smaller than 2 MB.",
          );
          continue;
        }
        accepted.push({
          name: file.name,
          url: file.uri,
          type: image ? "image" : "pdf",
        });
      }
      setStaged((previous) => [...previous, ...accepted]);
    } catch {
      setError("Could not open the file picker. Try again.");
    }
  }
  function sendMessage() {
    if (offline) {
      setError(
        "You're offline. Reconnect to send your message. Your draft is saved.",
      );
      return;
    }
    if (!draft.trim() && !staged.length) return;
    for (const file of staged)
      dispatch({
        type: "message",
        contactId: selectedId,
        message: {
          id: id(),
          direction: "out",
          kind: "attachment",
          text: file.name,
          attachment: file,
          time: time(),
        },
      });
    if (draft.trim())
      dispatch({
        type: "message",
        contactId: selectedId,
        message: {
          id: id(),
          direction: "out",
          kind: "text",
          text: draft.trim(),
          time: time(),
          ...(reply ? { reply } : {}),
        },
      });
    setDrafts((previous) => ({ ...previous, [selectedId]: "" }));
    setStaged([]);
    setReply("");
    setError("");
  }
  function submitPayment() {
    if (submitLock.current || !contact) return;
    const value = Number(amount);
    const invalid = paymentError(
      value,
      page === "request" ? Number.MAX_SAFE_INTEGER : state.balance,
    );
    if (invalid || offline) {
      setError(
        offline ? "You're offline. Reconnect and try again." : (invalid ?? ""),
      );
      return;
    }
    submitLock.current = true;
    const paymentId = id();
    setResultId(paymentId);
    setRequestResult(page === "request");
    if (page === "request")
      dispatch({
        type: "message",
        contactId: contact.id,
        message: {
          id: paymentId,
          kind: "request",
          direction: "out",
          text: note || "Payment request",
          amount: value,
          time: time(),
          status: "pending",
        },
      });
    else {
      dispatch({
        type: "pay",
        transaction: {
          id: paymentId,
          contactId: contact.id,
          amount: value,
          note: note || "Payment",
          direction: "out",
          status: "pending",
          day: "Today",
        },
        time: time(),
      });
      const status = failNext ? "failed" : "completed";
      timers.current.push(
        setTimeout(
          () => dispatch({ type: "settle", id: paymentId, status }),
          1300,
        ),
      );
      setFailNext(false);
    }
    go("result");
  }
  function receive() {
    const invalid = paymentError(
      Number(receiveAmount),
      Number.MAX_SAFE_INTEGER,
    );
    if (invalid || offline) {
      setError(
        offline ? "Reconnect to simulate receiving funds." : (invalid ?? ""),
      );
      return;
    }
    if (received) return;
    dispatch({
      type: "receive",
      transaction: {
        id: id(),
        contactId: "self",
        amount: Number(receiveAmount),
        note: "Sample receipt",
        direction: "in",
        status: "completed",
        day: "Today",
      },
      time: time(),
    });
    setReceived(true);
    setError("");
  }
  function showTransaction(item: Transaction) {
    setDetailId(item.id);
    setDialog("transaction");
  }
  function personRow(person: Contact) {
    return (
      <ContactRow
        key={person.id}
        name={person.name}
        {...(person.avatar ? { uri: person.avatar } : {})}
        preview={person.preview}
        time={person.time}
        unreadCount={person.unread}
        unreadLabel={`${person.unread} unread messages`}
        onPress={() => openChat(person)}
      />
    );
  }
  function activity(items: Transaction[]) {
    if (!items.length)
      return (
        <EmptyState
          icon="Wallet"
          title="Your activity starts here"
          description="Payments you send and receive will appear here."
        />
      );
    return ["Today", "Yesterday"].map((day) => {
      const rows = items.filter((item) => item.day === day);
      return rows.length > 0 ? (
        <DateGroup key={day} label={day}>
          {rows.map((item) => {
            const person = state.contacts.find(
              (entry) => entry.id === item.contactId,
            );
            return (
              <ActivityRow
                key={item.id}
                name={person?.name ?? "You"}
                {...(person?.avatar ? { uri: person.avatar } : {})}
                description={item.note}
                amount={`${item.direction === "in" ? "+" : "-"}${formatSats(item.amount)}`}
                unit="sats"
                state={item.status}
                statusLabel={statusLabel(item.status)}
                onPress={() => showTransaction(item)}
              />
            );
          })}
        </DateGroup>
      ) : null;
    });
  }
  function renderMessage(message: Message) {
    const direction = message.direction === "out" ? "outgoing" : "incoming";
    if (message.kind === "payment" || message.kind === "request") {
      const pending = message.status ?? "pending";
      return (
        <PaymentMessage
          key={message.id}
          direction={direction}
          kind={message.kind === "request" ? "request" : "transfer"}
          state={pending}
          label={
            message.kind === "request"
              ? "Payment request"
              : pending === "failed"
                ? "Payment failed"
                : pending === "pending"
                  ? "Payment pending"
                  : message.direction === "out"
                    ? "You paid"
                    : "You received"
          }
          amount={formatSats(message.amount ?? 0)}
          unit="sats"
          note={message.text}
          time={message.time}
          statusLabel={
            message.kind === "request"
              ? "Awaiting payment"
              : statusLabel(pending)
          }
          actions={
            <Button
              variant="ghost"
              size="small"
              onPress={() => {
                const item = state.transactions.find(
                  (entry) => entry.id === message.transactionId,
                );
                if (item) showTransaction(item);
                else setToast("Request pending. No funds have moved.");
              }}
            >
              Details
            </Button>
          }
        />
      );
    }
    return (
      <MessageBubble
        key={message.id}
        direction={direction}
        time={message.time}
        {...(message.direction === "out" ? { status: "Sent" } : {})}
        reply={
          message.reply ? (
            <ReplyPreview author="Reply" body={message.reply} />
          ) : undefined
        }
        reactions={
          message.reacted ? (
            <Reaction
              label="Love"
              count={1}
              selected
              onPress={() =>
                dispatch({
                  type: "react",
                  contactId: selectedId,
                  messageId: message.id,
                })
              }
            />
          ) : undefined
        }
        actions={
          <MessageActions
            label={`Actions for ${message.text}`}
            replyLabel="Reply"
            reactLabel={message.reacted ? "Remove reaction" : "React"}
            onReply={() => setReply(message.text)}
            onReact={() =>
              dispatch({
                type: "react",
                contactId: selectedId,
                messageId: message.id,
              })
            }
          />
        }
      >
        {message.attachment ? (
          <AttachmentCard
            name={message.attachment.name}
            label={`Open ${message.attachment.name}`}
            {...(message.attachment.type === "image"
              ? { previewUri: message.attachment.url }
              : { description: "PDF" })}
            onPress={() => {
              setAttachment(message.attachment);
              setDialog("attachment");
            }}
          />
        ) : (
          message.text
        )}
      </MessageBubble>
    );
  }
  const filtered = state.contacts.filter(
    (person) =>
      (group === "All" || person.group === group) &&
      person.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const header =
    page === "chat" && contact ? (
      <ConversationHeader
        name={contact.name}
        {...(contact.avatar ? { uri: contact.avatar } : {})}
        subtitle={contact.group}
        backLabel="Back to contacts"
        onBack={() => go("contacts")}
        actions={
          <IconButton
            icon="MoreHorizontal"
            label="Contact details"
            onPress={() =>
              setToast(`${contact.name} · ${contact.group} · Sample contact`)
            }
          />
        }
      />
    ) : (
      <ScreenHeader
        title={
          page === "wallet"
            ? "Wallet"
            : page === "contacts"
              ? "Contacts"
              : page === "pay"
                ? "Pay a friend"
                : page === "request"
                  ? "Request payment"
                  : page === "scan"
                    ? "Send"
                    : page === "history"
                      ? "Activity"
                      : page === "result"
                        ? "Payment"
                        : page === "receive"
                          ? "Receive"
                          : "Profile"
        }
        {...(page !== "wallet" && page !== "contacts" && page !== "result"
          ? {
              back: {
                label: "Back",
                onPress: () =>
                  go(page === "pay" || page === "request" ? "chat" : "wallet"),
              },
            }
          : {})}
        leading={
          page === "wallet" ? (
            <Button
              variant="ghost"
              aria-label="Open profile"
              padding={0}
              onPress={() => go("profile")}
            >
              <Avatar name="Dave" uri={portraits.profile} />
            </Button>
          ) : undefined
        }
        trailing={
          page === "wallet" ? (
            <IconButton
              label="Open settings"
              icon="Menu"
              onPress={() => setDialog("settings")}
            />
          ) : page === "contacts" ? (
            <IconButton
              label="Add contact"
              icon="Plus"
              onPress={() => setDialog("contact")}
            />
          ) : undefined
        }
      />
    );

  return (
    <UIProvider mode={mode}>
      <SafeAreaView
        style={[styles.flex, { backgroundColor: colors.background }]}
        testID="demo"
      >
        <StatusBar style={mode === "dark" ? "light" : "dark"} />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.shell}>
            {wide && (
              <Stack
                width={300}
                padding="$page"
                backgroundColor="$surface"
                borderRightWidth={1}
                borderColor="$surfaceRaised"
              >
                <Button
                  variant="ghost"
                  justifyContent="flex-start"
                  paddingHorizontal={0}
                  onPress={() => go("wallet")}
                >
                  <Icon name="Link" color="$accent" size={28} />
                  <Text variant="heading">Linky</Text>
                </Button>
                <Text variant="caption" muted marginTop="$page">
                  Your people
                </Text>
                <ScrollView
                  style={styles.flex}
                  keyboardShouldPersistTaps="handled"
                >
                  {state.contacts.map(personRow)}
                  <Button
                    variant="ghost"
                    icon="Plus"
                    onPress={() => setDialog("contact")}
                  >
                    Add contact
                  </Button>
                </ScrollView>
                <Row>
                  <Avatar name="Dave" uri={portraits.profile} />
                  <Stack flex={1} gap="$xs">
                    <Text variant="label">Dave</Text>
                    <Text variant="caption" muted>
                      Sample account
                    </Text>
                  </Stack>
                  <IconButton
                    icon="MoreHorizontal"
                    label="Sidebar settings"
                    onPress={() => setDialog("settings")}
                  />
                </Row>
                <Button
                  variant="ghost"
                  size="small"
                  onPress={() => navigate("/")}
                >
                  Component catalog
                </Button>
              </Stack>
            )}
            <View style={styles.main}>
              {offline && (
                <Notice
                  title="You're offline. Your drafts are saved."
                  icon="WifiOff"
                />
              )}
              {header}
              <ScrollView
                ref={content}
                style={styles.flex}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                onContentSizeChange={() => {
                  if (page === "chat")
                    content.current?.scrollToEnd({ animated: false });
                }}
                contentContainerStyle={[
                  styles.content,
                  page === "chat" && styles.messages,
                ]}
              >
                {page === "wallet" && (
                  <Stack gap="$page">
                    <WalletBalance
                      label="Available balance"
                      value={
                        unit === "sats"
                          ? formatSats(state.balance)
                          : (state.balance / 100000000).toFixed(8)
                      }
                      unit={unit}
                      amountLabel={`Available balance ${formatSats(state.balance)} sats. Change currency unit`}
                      onAmountPress={() =>
                        setUnit(unit === "sats" ? "BTC" : "sats")
                      }
                      receiveLabel="Receive"
                      sendLabel="Send"
                      onReceive={() => {
                        setReceived(false);
                        go("receive");
                      }}
                      onSend={() => go("scan")}
                    />
                    <Stack gap="$md">
                      <SectionHeader
                        title="People"
                        action={{
                          label: "All contacts",
                          onPress: () => go("contacts"),
                        }}
                      />
                      {state.contacts.length ? (
                        <Row gap="$page">
                          {state.contacts.slice(0, 3).map((person) => (
                            <PersonShortcut
                              key={person.id}
                              name={person.name}
                              label={person.name.split(" ")[0] ?? person.name}
                              {...(person.avatar ? { uri: person.avatar } : {})}
                              onPress={() => openChat(person)}
                            />
                          ))}
                        </Row>
                      ) : (
                        <Button
                          variant="ghost"
                          icon="Plus"
                          onPress={() => setDialog("contact")}
                        >
                          Add your first contact
                        </Button>
                      )}
                    </Stack>
                    <Stack gap="$xs">
                      <SectionHeader
                        title="Activity"
                        action={{
                          label: "View all",
                          onPress: () => go("history"),
                        }}
                      />
                      {activity(state.transactions.slice(0, 3))}
                    </Stack>
                    <Text variant="caption" muted textAlign="center">
                      Sample data
                    </Text>
                  </Stack>
                )}
                {page === "contacts" && (
                  <Stack>
                    <SearchField
                      label="Search contacts"
                      value={search}
                      onChangeText={setSearch}
                      clearLabel="Clear search"
                    />
                    <Row flexWrap="wrap" gap="$sm">
                      {["All", "Friends", "Family", "Work"].map((item) => (
                        <Chip
                          key={item}
                          selected={item === group}
                          onPress={() => setGroup(item)}
                        >
                          {item}
                        </Chip>
                      ))}
                    </Row>
                    {!filtered.length ? (
                      <EmptyState
                        icon="Users"
                        title={
                          state.contacts.length
                            ? "No contacts found"
                            : "Good conversations start here"
                        }
                        description={
                          state.contacts.length
                            ? "Try another name or choose a different group."
                            : "Add a friend to start chatting and paying."
                        }
                        action={
                          !state.contacts.length ? (
                            <Button onPress={() => setDialog("contact")}>
                              Add contact
                            </Button>
                          ) : undefined
                        }
                      />
                    ) : (
                      [true, false].map(
                        (pinned) =>
                          filtered.some(
                            (person) => person.pinned === pinned,
                          ) && (
                            <Stack key={String(pinned)} gap="$xs">
                              <SectionHeader
                                title={pinned ? "Pinned" : "Conversations"}
                              />
                              {filtered
                                .filter((person) => person.pinned === pinned)
                                .map(personRow)}
                            </Stack>
                          ),
                      )
                    )}
                  </Stack>
                )}
                {page === "chat" && contact && (
                  <Stack gap="$md">
                    <Text variant="caption" muted textAlign="center">
                      Today
                    </Text>
                    {!messages.length && (
                      <EmptyState
                        icon="MessageCircle"
                        title={`Say hello to ${contact.name.split(" ")[0]}`}
                        description="Messages and payments stay together here."
                      />
                    )}
                    {messages.map(renderMessage)}
                  </Stack>
                )}
                {(page === "pay" || page === "request") && contact && (
                  <Stack gap="$page" paddingTop="$page">
                    <Stack alignItems="center">
                      <Avatar
                        name={contact.name}
                        {...(contact.avatar ? { uri: contact.avatar } : {})}
                        size="large"
                      />
                      <Text variant="title">{contact.name}</Text>
                      <Text muted>
                        {page === "pay"
                          ? "You're sending"
                          : "You're requesting"}
                      </Text>
                    </Stack>
                    <AmountField
                      label="Amount in sats"
                      value={amount}
                      onChangeText={(value) => {
                        setAmount(digits(value));
                        setError("");
                      }}
                      unit="sats"
                      hint={`${formatSats(state.balance)} sats available`}
                    />
                    <TextField
                      label="What's it for?"
                      value={note}
                      onChangeText={setNote}
                      maxLength={160}
                      placeholder="Add a note, optional"
                      onSubmitEditing={submitPayment}
                    />
                    {error && <Notice title={error} tone="danger" />}
                    <Button
                      icon={page === "pay" ? "ArrowUpRight" : "ArrowDownLeft"}
                      onPress={submitPayment}
                    >{`${page === "pay" ? "Pay" : "Request"}${amount ? ` ${formatSats(Number(amount))} sats` : ""}`}</Button>
                    <Text variant="caption" muted textAlign="center">
                      Sample payment · no real funds
                    </Text>
                  </Stack>
                )}
                {page === "result" && (
                  <Stack aria-live="polite">
                    <PaymentResult
                      state={
                        requestResult
                          ? "pending"
                          : (result?.status ?? "pending")
                      }
                      title={
                        requestResult
                          ? "Request sent"
                          : result?.status === "completed"
                            ? "Payment complete"
                            : result?.status === "failed"
                              ? "Payment didn't go through"
                              : "Sending payment"
                      }
                      description={
                        requestResult
                          ? `${contact?.name ?? "Your contact"} can pay from your conversation. No funds have moved.`
                          : result?.status === "failed"
                            ? "Your funds are back in your available balance."
                            : result?.status === "pending"
                              ? "Waiting for confirmation. You can leave this screen."
                              : `You paid ${contact?.name ?? "your contact"}.`
                      }
                      amount={formatSats(Number(amount))}
                      unit="sats"
                      caption="Sample payment · no real funds"
                      action={
                        <Stack>
                          <Button
                            icon="MessageCircle"
                            onPress={() => go("chat")}
                          >
                            Back to chat
                          </Button>
                          <Button variant="ghost" onPress={() => go("wallet")}>
                            Go to wallet
                          </Button>
                        </Stack>
                      }
                    />
                    {note && (
                      <Text muted textAlign="center">
                        {note}
                      </Text>
                    )}
                  </Stack>
                )}
                {page === "receive" && (
                  <Stack gap="$page" paddingTop="$page">
                    {received ? (
                      <PaymentResult
                        state="completed"
                        title="Funds received"
                        description="Your wallet activity has been updated."
                        amount={formatSats(Number(receiveAmount))}
                        unit="sats"
                      />
                    ) : (
                      <>
                        <Text variant="title" textAlign="center">
                          Let a friend scan to pay
                        </Text>
                        <Text muted textAlign="center">
                          Create a request for your wallet.
                        </Text>
                        <QRCodeCard
                          value={request}
                          label="QR code for a sample Linky payment request"
                        />
                      </>
                    )}
                    <TextField
                      label="Amount in sats"
                      value={receiveAmount}
                      inputMode="numeric"
                      onChangeText={(value) => {
                        setReceiveAmount(digits(value));
                        setReceived(false);
                        setError("");
                      }}
                    />
                    <Text variant="caption" muted selectable textAlign="center">
                      {request}
                    </Text>
                    <Row>
                      <Button
                        flex={1}
                        variant="secondary"
                        icon="Copy"
                        onPress={() => void copy(request)}
                      >
                        Copy
                      </Button>
                      <Button
                        flex={1}
                        variant="secondary"
                        icon="Share2"
                        onPress={() => void share()}
                      >
                        Share
                      </Button>
                    </Row>
                    <Text variant="caption" muted textAlign="center">
                      Sample QR only · cannot receive real bitcoin
                    </Text>
                    {error && <Notice title={error} tone="danger" />}
                    <Button disabled={received} onPress={receive}>
                      {received
                        ? `Received ${formatSats(Number(receiveAmount))} sats`
                        : "Simulate receipt"}
                    </Button>
                  </Stack>
                )}
                {page === "scan" && (
                  <Stack gap="$page">
                    <Stack
                      backgroundColor="$surface"
                      borderRadius="$card"
                      minHeight={230}
                      alignItems="center"
                      justifyContent="center"
                      padding="$page"
                    >
                      <Icon name="QrCode" size={64} color="$muted" />
                      <Text variant="title">Scan a payment request</Text>
                      <Text variant="caption" muted>
                        Camera preview in the live app
                      </Text>
                    </Stack>
                    <Button
                      variant="secondary"
                      icon="QrCode"
                      disabled={!state.contacts.length}
                      onPress={() =>
                        beginPayment("pay", state.contacts[0], true)
                      }
                    >
                      Use sample QR
                    </Button>
                    <SectionHeader title="Or pay a contact" />
                    {state.contacts.map((person) => (
                      <ContactRow
                        key={person.id}
                        name={person.name}
                        {...(person.avatar ? { uri: person.avatar } : {})}
                        preview={person.group}
                        onPress={() => beginPayment("pay", person)}
                      />
                    ))}
                    {!state.contacts.length && (
                      <Button onPress={() => setDialog("contact")}>
                        Add a contact
                      </Button>
                    )}
                    <Text variant="caption" muted textAlign="center">
                      Sample payments · no real funds
                    </Text>
                  </Stack>
                )}
                {page === "history" && activity(state.transactions)}
                {page === "profile" && (
                  <Stack alignItems="center" paddingTop="$page" gap="$page">
                    <Avatar name="Dave" uri={portraits.profile} size="large" />
                    <Text variant="heading">Dave</Text>
                    <Text muted>Sample account</Text>
                    <Text variant="caption" muted>
                      Linky address
                    </Text>
                    <Row>
                      <Text selectable>dave@sample.linky</Text>
                      <IconButton
                        icon="Copy"
                        label="Copy sample address"
                        onPress={() => void copy("dave@sample.linky")}
                      />
                    </Row>
                    <Button
                      variant="secondary"
                      onPress={() => setDialog("settings")}
                    >
                      Appearance and settings
                    </Button>
                    <Text variant="caption" muted textAlign="center">
                      Fictional profile for design exploration
                    </Text>
                  </Stack>
                )}
              </ScrollView>
              {page === "chat" && contact && (
                <Stack padding="$md" paddingTop="$sm" gap="$sm">
                  {error && <Notice title={error} tone="danger" />}
                  <MessageComposer
                    label="Message"
                    value={draft}
                    onChangeText={(value) =>
                      setDrafts((previous) => ({
                        ...previous,
                        [selectedId]: value,
                      }))
                    }
                    onSend={sendMessage}
                    sendLabel="Send message"
                    canSend={Boolean(draft.trim() || staged.length)}
                    attachmentAction={{
                      label: "Attach image or PDF",
                      onPress: () => void attach(),
                    }}
                    attachments={
                      <AttachmentTray
                        items={staged.map((file, index) => ({
                          id: String(index),
                          name: file.name,
                          removeLabel: `Remove ${file.name}`,
                          ...(file.type === "image"
                            ? { previewUri: file.url }
                            : {}),
                        }))}
                        onRemove={(key) =>
                          setStaged((previous) =>
                            previous.filter(
                              (_, index) => String(index) !== key,
                            ),
                          )
                        }
                      />
                    }
                    reply={
                      reply ? (
                        <ReplyPreview
                          author="Reply"
                          body={reply}
                          dismissLabel="Cancel reply"
                          onDismiss={() => setReply("")}
                        />
                      ) : undefined
                    }
                    paymentActions={
                      <>
                        <ChatPaymentAction
                          kind="request"
                          onPress={() => beginPayment("request")}
                        >
                          Request
                        </ChatPaymentAction>
                        <ChatPaymentAction
                          kind="pay"
                          onPress={() => beginPayment("pay")}
                        >{`Pay ${contact.name.split(" ")[0]}`}</ChatPaymentAction>
                      </>
                    }
                    caption="Sample conversation · no messages leave this device"
                  />
                </Stack>
              )}
              {(page === "wallet" || page === "contacts") && (
                <Stack alignItems="center" padding="$md" gap="$xs">
                  <BottomNav
                    label="Main navigation"
                    items={navigation}
                    value={page}
                    onValueChange={go}
                  />
                </Stack>
              )}
            </View>
          </View>
          {toast && (
            <View style={styles.toast}>
              <Toast
                message={toast}
                dismissLabel="Dismiss notification"
                onDismiss={() => setToast("")}
              />
            </View>
          )}
          <DemoDialogs
            dialog={dialog}
            setDialog={setDialog}
            mode={mode}
            setMode={setMode}
            offline={offline}
            setOffline={setOffline}
            failNext={failNext}
            setFailNext={setFailNext}
            state={state}
            dispatch={dispatch}
            reset={reset}
            go={go}
            openChat={openChat}
            notify={setToast}
            transaction={transaction}
            attachment={attachment}
            openCatalog={() => navigate("/")}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </UIProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  shell: {
    flex: 1,
    flexDirection: "row",
    width: "100%",
    maxWidth: 1100,
    alignSelf: "center",
  },
  main: {
    flex: 1,
    minWidth: 0,
    maxWidth: 480,
    marginHorizontal: "auto",
    width: "100%",
  },
  content: { paddingHorizontal: 20, paddingTop: 0, paddingBottom: 28 },
  messages: { flexGrow: 1, justifyContent: "flex-end" },
  toast: {
    position: "absolute",
    bottom: 20,
    left: 16,
    right: 16,
    maxWidth: 440,
    marginLeft: "auto",
    zIndex: 1000,
  },
});
