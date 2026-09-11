export const sections = [
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
    code: '<ContactRow name="Anna Novak" uri={portraitUri}\n  preview="Thanks for dinner!" time="12:42"\n  unreadCount={2} unreadLabel="2 unread messages"\n  onPress={openConversation} />',
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
