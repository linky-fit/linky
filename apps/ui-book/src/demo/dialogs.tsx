import { useState } from "react";
import type { Dispatch } from "react";
import { Linking, Platform } from "react-native";
import {
  Amount,
  Avatar,
  Button,
  Checkbox,
  Dialog,
  ImagePreview,
  ListRow,
  Notice,
  SegmentedControl,
  SelectField,
  Stack,
  StatusBadge,
  Text,
  TextField,
} from "@linky/ui";
import type { ColorMode } from "@linky/ui";
import { formatSats } from "./model";
import type {
  Attachment,
  Contact,
  DemoAction,
  DemoState,
  Transaction,
} from "./model";

export type DemoDialog =
  | "settings"
  | "contact"
  | "transaction"
  | "attachment"
  | null;
interface DemoDialogsProps {
  dialog: DemoDialog;
  setDialog: (dialog: DemoDialog) => void;
  mode: ColorMode;
  setMode: (mode: ColorMode) => void;
  offline: boolean;
  setOffline: (value: boolean) => void;
  failNext: boolean;
  setFailNext: (value: boolean) => void;
  state: DemoState;
  dispatch: Dispatch<DemoAction>;
  reset: () => void;
  go: (page: string) => void;
  openChat: (contact: Contact) => void;
  notify: (message: string) => void;
  transaction: Transaction | undefined;
  attachment: Attachment | undefined;
  openCatalog: () => void;
}

export function DemoDialogs({
  dialog,
  setDialog,
  mode,
  setMode,
  offline,
  setOffline,
  failNext,
  setFailNext,
  state,
  dispatch,
  reset,
  go,
  openChat,
  notify,
  transaction,
  attachment,
  openCatalog,
}: DemoDialogsProps) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState<Contact["group"]>("Friends");
  const person = state.contacts.find(
    (contact) => contact.id === transaction?.contactId,
  );
  function addContact() {
    if (!name.trim()) return;
    const contact: Contact = {
      id: `contact-${state.contacts.length}-${Date.now()}`,
      name: name.trim(),
      group,
      pinned: false,
      unread: 0,
      preview: "Start a conversation",
      time: "",
    };
    dispatch({ type: "contact", contact });
    setName("");
    setDialog(null);
    openChat(contact);
  }
  async function openAttachment() {
    if (!attachment) return;
    try {
      await Linking.openURL(attachment.url);
    } catch {
      notify("Could not open the document on this device.");
    }
  }
  return (
    <>
      <Dialog
        open={dialog === "settings"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="Settings"
        description="Appearance and sample scenarios for this preview."
        closeLabel="Close settings"
      >
        <Text variant="label">Appearance</Text>
        <SegmentedControl
          label="Appearance"
          value={mode}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
          ]}
          onValueChange={(value) => {
            if (value === "dark" || value === "light") setMode(value);
          }}
        />
        <Text variant="label">Sample scenarios</Text>
        <Checkbox
          label="Offline"
          checked={offline}
          onCheckedChange={setOffline}
        />
        <Checkbox
          label="Fail next payment"
          checked={failNext}
          onCheckedChange={setFailNext}
        />
        <Button
          variant="secondary"
          onPress={() => {
            dispatch({ type: "zero" });
            setDialog(null);
            go("wallet");
          }}
        >
          Try zero balance
        </Button>
        <Button
          variant="secondary"
          onPress={() => {
            reset();
            dispatch({ type: "empty" });
          }}
        >
          Try empty account
        </Button>
        <Button
          variant="secondary"
          onPress={() => {
            state.transactions
              .filter((item) => item.status === "pending")
              .forEach((item) =>
                dispatch({ type: "settle", id: item.id, status: "completed" }),
              );
            notify("Pending sample payments completed");
          }}
        >
          Complete pending payments
        </Button>
        <Button variant="ghost" onPress={reset}>
          Reset sample data
        </Button>
        <Button variant="ghost" onPress={openCatalog}>
          Component catalog
        </Button>
        <Text variant="caption" muted>
          This preview uses local sample data. Reloading starts a fresh session.
        </Text>
      </Dialog>
      <Dialog
        open={dialog === "contact"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="Add contact"
        description="Creates a sample contact in this session."
        closeLabel="Close add contact"
      >
        <TextField
          label="Name"
          placeholder="Your friend's name"
          value={name}
          onChangeText={setName}
          maxLength={100}
          onSubmitEditing={addContact}
        />
        <SelectField
          description="Choose a group for this contact."
          label="Group"
          value={group}
          options={[
            { value: "Friends", label: "Friends" },
            { value: "Family", label: "Family" },
            { value: "Work", label: "Work" },
          ]}
          onValueChange={(value) => {
            if (value === "Friends" || value === "Family" || value === "Work")
              setGroup(value);
          }}
          closeLabel="Close groups"
        />
        <Button disabled={!name.trim()} onPress={addContact}>
          Add contact
        </Button>
      </Dialog>
      <Dialog
        open={dialog === "transaction"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="Payment details"
        description="Sample payment activity. No real funds."
        closeLabel="Close payment details"
      >
        {transaction && (
          <Stack>
            <Stack alignItems="center">
              <Avatar
                name={person?.name ?? "You"}
                {...(person?.avatar ? { uri: person.avatar } : {})}
                size="large"
              />
              <Text variant="title">{person?.name ?? "You"}</Text>
              <Amount
                value={`${transaction.direction === "out" ? "-" : "+"}${formatSats(transaction.amount)}`}
                unit="sats"
                size="balance"
              />
              <StatusBadge
                label={transaction.status}
                tone={
                  transaction.status === "completed"
                    ? "success"
                    : transaction.status === "failed"
                      ? "danger"
                      : "warning"
                }
              />
            </Stack>
            <ListRow title="Note" description={transaction.note} />
            <ListRow title="Date" description={transaction.day} />
            <ListRow title="Network fee" description="0 sats · sample" />
            {transaction.status === "failed" && (
              <Notice
                title="Your funds were returned to your wallet."
                tone="danger"
              />
            )}
            {transaction.status === "pending" && (
              <Notice
                title="Waiting for confirmation."
                description="This amount is already excluded from your available balance."
                tone="warning"
              />
            )}
            {person && (
              <Button
                icon="MessageCircle"
                onPress={() => {
                  setDialog(null);
                  openChat(person);
                }}
              >
                Open conversation
              </Button>
            )}
          </Stack>
        )}
      </Dialog>
      <Dialog
        open={dialog === "attachment"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={attachment?.name ?? "Attachment"}
        description="Attachment from this sample conversation."
        closeLabel="Close attachment"
      >
        {attachment?.type === "image" ? (
          <ImagePreview uri={attachment.url} label={attachment.name} />
        ) : attachment ? (
          <Button
            icon="FileText"
            {...(Platform.OS === "web"
              ? {
                  render: "a",
                  href: attachment.url,
                  download: attachment.name,
                  target: "_blank",
                }
              : { onPress: () => void openAttachment() })}
          >
            Download PDF
          </Button>
        ) : null}
      </Dialog>
    </>
  );
}
