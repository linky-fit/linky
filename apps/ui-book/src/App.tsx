import { useState } from "react";
import {
  UIProvider,
  Button,
  EmptyState,
  Icon,
  IconButton,
  SearchField,
  SegmentedControl,
  Text,
  themes,
  Toast,
} from "@linky/ui";
import type { ColorMode } from "@linky/ui";
import {
  Attachments,
  ChatExample,
  Controls,
  ExampleFrame,
  Feedback,
  Fields,
  Foundations,
  Messaging,
  Navigation,
  Payments,
  People,
  WalletExample,
} from "./examples";

const sections = [
  {
    id: "compositions",
    title: "In context",
    description: "The approved wallet and chat, composed from the library.",
    exports:
      "WalletBalance, PersonShortcut, ActivityRow, DateGroup, ScreenHeader, ConversationHeader, BottomNav, MessageBubble, PaymentMessage, MessageComposer, ChatPaymentAction",
    code: '<UIProvider mode="dark">\n  <WalletBalance\n    label="Available balance" value="84,250" unit="sats"\n    receiveLabel="Receive" sendLabel="Send"\n    onReceive={openReceive} onSend={openSend}\n  />\n</UIProvider>',
  },
  {
    id: "foundations",
    title: "Foundations",
    description:
      "Manrope, semantic tokens, shared layouts, and the full icon set.",
    exports:
      "UIProvider, Stack, Row, Surface, Divider, Text, Icon, icons, palette, themes, space, radius, size, typography, motion, zIndex, breakpoints",
    code: '<Stack gap="$lg">\n  <Text variant="heading">People and payments</Text>\n  <Surface><Row><Icon name="Wallet" /><Text>Wallet</Text></Row></Surface>\n  <Divider />\n</Stack>',
  },
  {
    id: "controls",
    title: "Controls",
    description:
      "Actions, touch targets, selected filters, disabled and busy states.",
    exports: "Button, IconButton, Chip, SegmentedControl",
    code: '<Button icon="Send" loading={sending} loadingLabel="Sending"\n  onPress={send}>Send</Button>\n<Chip selected={selected} onPress={toggle}>Friends</Chip>\n<SegmentedControl label="View" value={view}\n  options={options} onValueChange={setView} />',
  },
  {
    id: "fields",
    title: "Fields",
    description:
      "Controlled input, clearable search, validation, selection, and amounts.",
    exports: "TextField, SearchField, AmountField, SelectField",
    code: '<SearchField label="Search people" clearLabel="Clear search"\n  value={query} onChangeText={setQuery} />\n<SelectField label="Group" description="Choose a contact group."\n  closeLabel="Close" value={group} options={groups}\n  onValueChange={setGroup} />',
  },
  {
    id: "people",
    title: "People & lists",
    description:
      "Portraits, initials, unread counts, long names, and quiet list rows.",
    exports: "Avatar, PersonShortcut, UnreadBadge, ContactRow, ListRow",
    code: '<ContactRow name="Anna Novak" uri="/avatars/anna.png"\n  preview="Thanks for dinner!" time="12:42"\n  unreadCount={2} unreadLabel="2 unread messages"\n  onPress={openConversation} />',
  },
  {
    id: "messaging",
    title: "Messaging",
    description: "Send a local message, reply, react, and stage an attachment.",
    exports:
      "MessageBubble, ReplyPreview, Reaction, MessageActions, PaymentMessage, MessageComposer, ChatPaymentAction",
    code: '<MessageComposer label="Message" value={draft}\n  onChangeText={setDraft} sendLabel="Send message"\n  onSend={send} disabled={offline}\n  attachments={<AttachmentTray items={files} onRemove={remove} />}\n/>',
  },
  {
    id: "attachments",
    title: "Attachments",
    description: "Documents, image previews, staged files, and removal.",
    exports: "AttachmentCard, AttachmentTray",
    code: '<AttachmentCard name="receipt.pdf" description="PDF · 42 KB"\n  label="Preview receipt" onPress={openPreview} />\n<AttachmentTray items={attachments} onRemove={removeAttachment} />',
  },
  {
    id: "navigation",
    title: "Navigation",
    description:
      "Screen titles, conversation identity, and floating navigation content.",
    exports: "ScreenHeader, ConversationHeader, BottomNav",
    code: '<ScreenHeader title="Wallet" trailing={settingsAction} />\n<BottomNav label="Main navigation" items={items}\n  value={page} onValueChange={setPage} />',
  },
  {
    id: "feedback",
    title: "Feedback & dialogs",
    description:
      "Empty, loading, offline, error, toast, and keyboard-accessible dialogs.",
    exports: "Notice, EmptyState, LoadingState, Toast, Dialog, StatusBadge",
    code: '<Dialog open={open} onOpenChange={setOpen}\n  title="Add a contact" description="Enter their details."\n  closeLabel="Close dialog">\n  <TextField label="Name" value={name} onChangeText={setName} />\n</Dialog>',
  },
  {
    id: "payments",
    title: "Payments & wallet",
    description:
      "Switch outcomes and inspect amounts, transfers, requests, and encoded QR.",
    exports:
      "PaymentResult, QRCodeCard, PaymentMessage, ActivityRow, Amount, WalletBalance, SectionHeader, DateGroup, StatusBadge",
    code: '<PaymentResult state={state} title={title}\n  description={description} amount="1,250" unit="sats" />\n<QRCodeCard value={request} label="Receive request QR code" />',
  },
];
export function App() {
  const [mode, setMode] = useState<ColorMode>("dark");
  const [selected, setSelected] = useState("compositions");
  const [query, setQuery] = useState("");
  const [width, setWidth] = useState("comfortable");
  const [notification, setNotification] = useState("");
  const current =
    sections.find((section) => section.id === selected) ?? sections[0];
  const matches = sections.filter((section) =>
    `${section.title} ${section.exports}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const colors = themes[mode];
  const shellStyle = {
    color: colors.color,
    backgroundColor: colors.background,
    "--book-background": colors.background,
    "--book-surface": colors.surface,
    "--book-border": colors.borderColor,
    "--book-muted": colors.muted,
    "--book-accent": colors.accent,
    "--book-selected": colors.accentSoft,
  };
  return (
    <UIProvider mode={mode}>
      <div className="book" data-theme={mode} style={shellStyle}>
        <a className="skip-link" href="#preview">
          Skip to preview
        </a>
        <aside className="book-sidebar">
          <div className="book-brand">
            <Icon name="Wallet" color="$accent" size={26} />
            <Text variant="title">Linky</Text>
            <Text variant="caption" muted>
              UI next
            </Text>
          </div>
          <SearchField
            label="Find a component"
            placeholder="Find a component…"
            clearLabel="Clear component search"
            value={query}
            onChangeText={setQuery}
          />
          <nav aria-label="Component groups">
            {matches.map((section) => (
              <button
                key={section.id}
                className="nav-link"
                aria-current={selected === section.id ? "page" : undefined}
                onClick={() => setSelected(section.id)}
              >
                <span>{section.title}</span>
                <Icon name="ChevronRight" size={14} color="$muted" />
              </button>
            ))}
            {matches.length === 0 && (
              <p className="muted small">No matching components.</p>
            )}
          </nav>
          <div className="sidebar-note">
            <Text variant="caption" muted>
              Built with @linky/ui
            </Text>
            <Text variant="caption" muted>
              Tamagui · Manrope
            </Text>
            <Text variant="caption" muted>
              Fictional sample data. No services.
            </Text>
          </div>
        </aside>
        <main id="preview" className="book-main">
          <header className="book-toolbar">
            <Text variant="label" muted>
              Component library
            </Text>
            <div className="toolbar-controls">
              <SegmentedControl
                label="Preview width"
                value={width}
                onValueChange={setWidth}
                options={[
                  { value: "comfortable", label: "Comfortable" },
                  { value: "narrow", label: "Narrow · 320px" },
                ]}
              />
              <IconButton
                icon={mode === "dark" ? "Sun" : "Moon"}
                label={
                  mode === "dark"
                    ? "Switch to light theme"
                    : "Switch to dark theme"
                }
                onPress={() => setMode(mode === "dark" ? "light" : "dark")}
              />
            </div>
          </header>
          <div className="book-content">
            <div className="section-heading">
              <h1>{current.title}</h1>
              <p>{current.description}</p>
            </div>
            <p className="sample-note">
              Interactive examples · fictional people and payments
            </p>
            <div
              className={`preview-area ${width === "narrow" ? "is-narrow" : ""}`}
            >
              {query && matches.length === 0 ? (
                <EmptyState
                  title="No components found"
                  description="Try searching for a component name, such as Button or Dialog."
                  icon="Search"
                  action={
                    <Button onPress={() => setQuery("")}>Clear search</Button>
                  }
                />
              ) : selected === "compositions" ? (
                <div className="composition-grid">
                  <section className="composition">
                    <h2>Wallet</h2>
                    <ExampleFrame>
                      <WalletExample notify={setNotification} />
                    </ExampleFrame>
                  </section>
                  <section className="composition">
                    <h2>Conversation</h2>
                    <ExampleFrame>
                      <ChatExample notify={setNotification} />
                    </ExampleFrame>
                  </section>
                </div>
              ) : (
                <section className="single-example">
                  <ExampleFrame>
                    <div className="component-padding">
                      {selected === "foundations" && <Foundations />}
                      {selected === "controls" && (
                        <Controls notify={setNotification} />
                      )}
                      {selected === "fields" && <Fields />}
                      {selected === "people" && (
                        <People notify={setNotification} />
                      )}
                      {selected === "messaging" && (
                        <Messaging notify={setNotification} />
                      )}
                      {selected === "attachments" && (
                        <Attachments notify={setNotification} />
                      )}
                      {selected === "navigation" && (
                        <Navigation notify={setNotification} />
                      )}
                      {selected === "feedback" && (
                        <Feedback notify={setNotification} />
                      )}
                      {selected === "payments" && <Payments />}
                    </div>
                  </ExampleFrame>
                </section>
              )}
            </div>
            <section className="usage">
              <h2>Use these components</h2>
              <p className="export-list">{current.exports}</p>
              <pre>
                <code>{`import { ${Array.from(new Set(Array.from(current.code.matchAll(/<([A-Z]\w*)/g), (match) => match[1]))).join(", ")} } from "@linky/ui";\n\n${current.code}`}</code>
              </pre>
              <p>
                Examples use local React state. Apps provide translated labels,
                formatted values, and action handlers. Open the package README
                for the ownership and platform notes.
              </p>
            </section>
          </div>
        </main>
        {notification && (
          <div className="book-toast">
            <Toast
              message={notification}
              dismissLabel="Dismiss notification"
              onDismiss={() => setNotification("")}
            />
          </div>
        )}
      </div>
    </UIProvider>
  );
}
