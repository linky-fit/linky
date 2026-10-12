import { decodeNpub } from "@linky-fit/linkstr";
import { NonEmptyString1000, type ContactId } from "@linky-fit/linksync";
import {
  RegistryContext,
  useAtom,
  useAtomSet,
  useAtomSuspense,
  useAtomValue,
} from "@linky-fit/linkstr-react";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { navigateTo } from "../../../hooks/useRouting";
import type { Route } from "../../../types/route";
import {
  normalizeContactGroups,
  serializeContactGroups,
} from "../../../utils/contactGroups";
import { isDeletedContact } from "../../../utils/contactName";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import type { MessageContactsGroupAssignment } from "../../../components/ChatMessage";
import { blockPubkey } from "../../lib/blockList";
import { runWrite } from "../../lib/storeWrite";
import {
  pendingContactsGroupAssignmentAtom,
  pendingUnknownContactAddAtom,
  type PendingContactsGroupAssignment,
} from "../../state/contacts/chatContacts";
import { contactsCommandsAtom } from "../../state/contacts/commands";
import {
  contactFormAtom,
  contactNewPrefillAtom,
  makeEmptyContactForm,
} from "../../state/contacts/contactForm";
import { syncMuteListAtom } from "../../state/contacts/muteList";
import { contactGroupsAtom } from "../../state/contacts/readModel";
import { currentNpubAtom, currentNsecAtom } from "../../state/session/session";
import {
  contactPaymentIntentAtom,
  payAmountAtom,
} from "../../state/wallet/contactPay";
import { normalizePubkeyHex } from "../messages/contactIdentity";
import { useMessageWrites } from "../messages/useMessageWrites";
import { useMessagesCommands } from "../messages/useMessagesCommands";
import { useSetNavIntent } from "../shell/navIntents";
import { usePushToast, useSetStatus, useTranslation } from "../shell";
import {
  useContactsRepository,
  useConversationsRepository,
  useUnknownSendersRepository,
} from "../useLinksync";
import type { ChatSelectedContact } from "./useDisplayContacts";
import { useContacts } from "./useDisplayContacts";
import { useSaveNpubContact } from "./useSaveNpubContact";

/** Empties the new/edit contact form. */
const useClearContactForm = () => {
  const setContactForm = useAtomSet(contactFormAtom);
  return React.useCallback(
    () =>
      setContactForm((draft) => ({
        ...draft,
        form: makeEmptyContactForm(),
        editingId: null,
        initial: null,
      })),
    [setContactForm],
  );
};

/** Leaves a contact's screens for the contact list. */
export const useCloseContactDetail = () => {
  const clearContactForm = useClearContactForm();
  return React.useCallback(() => {
    clearContactForm();
    navigateTo({ route: "contacts" });
  }, [clearContactForm]);
};

/** Opens the pay screen for a saved contact; `fromChat` makes back return to the conversation. */
export const useOpenContactPay = () => {
  const contacts = useContacts();
  const setContactPayBackToChat = useSetNavIntent("contactPayBackToChat");
  const setContactPaymentIntent = useAtomSet(contactPaymentIntentAtom);
  return React.useCallback(
    (
      contactId: string,
      fromChat = false,
      intent: "pay" | "request" = "pay",
    ) => {
      const knownContact =
        contacts.find((row) => row.id.trim() === contactId) ?? null;
      if (!knownContact) return;

      setContactPayBackToChat(fromChat ? knownContact.id : null);
      setContactPaymentIntent(intent);
      navigateTo({ route: "contactPay", id: knownContact.id });
    },
    [contacts, setContactPayBackToChat, setContactPaymentIntent],
  );
};

// Deleting runs on one click; the toast that follows offers to undo it.
export const useDeleteContact = () => {
  const { t } = useTranslation();
  const setStatus = useSetStatus();
  const pushToast = usePushToast();
  const contactsCommands = useAtomSuspense(contactsCommandsAtom).value;
  const closeContactDetail = useCloseContactDetail();

  const undoDeleteContact = React.useCallback(
    async (id: ContactId) => {
      const result = await contactsCommands.restoreContact(id);
      setStatus(
        result.ok
          ? t("contactRestored")
          : `${t("errorPrefix")}: ${result.error}`,
      );
    },
    [contactsCommands, setStatus, t],
  );

  return React.useCallback(
    async (id: ContactId) => {
      const result = await contactsCommands.deleteContact(id);
      if (!result.ok) {
        setStatus(`${t("errorPrefix")}: ${result.error}`);
        return;
      }
      closeContactDetail();
      pushToast(t("contactDeleted"), {
        action: {
          label: t("undoDeleteContact"),
          onClick: () => {
            void undoDeleteContact(id);
          },
        },
      });
    },
    [
      closeContactDetail,
      contactsCommands,
      pushToast,
      setStatus,
      t,
      undoDeleteContact,
    ],
  );
};

/** Blocks a pubkey on this device and publishes the mute list, best effort. */
const useBlockPubkey = () => {
  const currentNsec = useAtomValue(currentNsecAtom);
  const syncMuteList = useAtomValue(syncMuteListAtom);
  return React.useCallback(
    async (pubkeyHex: string): Promise<boolean> => {
      const pubkey = normalizePubkeyHex(pubkeyHex);
      if (!pubkey) return false;
      blockPubkey(pubkey);
      // Local blocklist applies either way; the mute list is best effort.
      if (currentNsec) void syncMuteList();
      return true;
    },
    [currentNsec, syncMuteList],
  );
};

const useRemoveContactMessages = () =>
  useMessageWrites({
    conversations: useConversationsRepository(),
    unknownSenders: useUnknownSendersRepository(),
  }).removeLocalNostrMessagesByContactId;

/** Saving or blocking the unknown sender whose conversation is open. */
export const useUnknownSenderActions = (
  route: Route,
  selectedChatContact: ChatSelectedContact | null,
) => {
  const { t } = useTranslation();
  const setStatus = useSetStatus();
  const saveNpubContact = useSaveNpubContact();
  const messagesCommands = useMessagesCommands();
  const setPendingUnknownContactAdd = useAtomSet(pendingUnknownContactAddAtom);
  const blockPubkeyAndPublishMuteList = useBlockPubkey();
  const removeLocalNostrMessagesByContactId = useRemoveContactMessages();

  const addUnknownContactFromChat = React.useCallback(async () => {
    if (route.kind !== "chat") return;
    if (!selectedChatContact?.isUnknownContact) return;

    const contactId = selectedChatContact.id.trim();
    const npub = normalizeNpubIdentifier(selectedChatContact.npub ?? "");
    if (!contactId || !npub) {
      setStatus(t("chatUnknownContactAddFailed"));
      return;
    }

    const saved = saveNpubContact(npub);
    if (!saved) return;
    if (!saved.created) {
      void messagesCommands?.reassignContactMessages(
        contactId,
        saved.contact.id,
      );
      setStatus(t("contactSaved"));
      navigateTo({ route: "chat", id: saved.contact.id });
      return;
    }
    setPendingUnknownContactAdd({
      sourceContactId: contactId,
      targetNpub: npub,
    });
  }, [
    messagesCommands,
    route.kind,
    saveNpubContact,
    selectedChatContact,
    setPendingUnknownContactAdd,
    setStatus,
    t,
  ]);

  const blockUnknownContactFromChat = React.useCallback(async () => {
    if (route.kind !== "chat") return;
    if (!selectedChatContact?.isUnknownContact) return;

    const contactId = selectedChatContact.id.trim();
    if (!contactId) return;

    const unknownPubkeyHex = (() => {
      const directPubkey = normalizePubkeyHex(
        selectedChatContact.unknownPubkeyHex,
      );
      if (directPubkey) return directPubkey;

      const normalizedNpub = normalizeNpubIdentifier(
        selectedChatContact.npub ?? "",
      );
      if (!normalizedNpub) return null;

      return decodeNpub(normalizedNpub);
    })();

    if (!unknownPubkeyHex) return;

    await blockPubkeyAndPublishMuteList(unknownPubkeyHex);

    removeLocalNostrMessagesByContactId(contactId);
    setStatus(t("chatUnknownContactBlocked"));
    navigateTo({ route: "contacts" });
  }, [
    blockPubkeyAndPublishMuteList,
    removeLocalNostrMessagesByContactId,
    route.kind,
    selectedChatContact,
    setStatus,
    t,
  ]);

  return { addUnknownContactFromChat, blockUnknownContactFromChat };
};

/** Opens the npub a message mentions: its contact, the own profile, or a new contact. */
export const useOpenNpubMessageContact = () => {
  const { t } = useTranslation();
  const setStatus = useSetStatus();
  const contacts = useContacts();
  const currentNpub = useAtomValue(currentNpubAtom);
  const saveNpubContact = useSaveNpubContact();
  const openSavedContact = useSetNavIntent("openSavedContactNpub");
  return React.useCallback(
    (rawNpub: string) => {
      const npub = normalizeNpubIdentifier(rawNpub);
      if (!npub) return;

      const existing = contacts.find(
        (contact) =>
          !isDeletedContact(contact) &&
          normalizeNpubIdentifier(contact.npub ?? "") === npub,
      );
      if (existing?.id) {
        navigateTo({ route: "contact", id: existing.id });
        return;
      }

      const myNpub = normalizeNpubIdentifier(currentNpub ?? "");
      if (myNpub && myNpub === npub) {
        navigateTo({ route: "profile" });
        return;
      }

      const saved = saveNpubContact(npub);
      if (!saved) return;
      openSavedContact(saved.npub);
      setStatus(t("contactSaved"));
    },
    [contacts, currentNpub, openSavedContact, saveNpubContact, setStatus, t],
  );
};

const reportContactsAddedToGroup = (
  pending: PendingContactsGroupAssignment,
  group: string,
): void => {
  const contactIds = pending.savedContactIds;
  reportAppLog({
    tag: "contacts.addToGroup",
    summary: `${contactIds.length} contacts from a chat message added to group "${group}"`,
    links: { contact: contactIds, message: pending.messageId },
    payload: { contactIds, group, messageId: pending.messageId },
  });
};

/** Saving the npubs a message lists, then offering them a group. */
export const useNpubMessageContacts = () => {
  const { t } = useTranslation();
  const setStatus = useSetStatus();
  const contacts = useContacts();
  const contactsRepository = useContactsRepository();
  const currentNpub = useAtomValue(currentNpubAtom);
  const saveNpubContact = useSaveNpubContact();
  const { groupNames } = useAtomValue(contactGroupsAtom);
  const [pendingContactsGroupAssignment, setPendingContactsGroupAssignment] =
    useAtom(pendingContactsGroupAssignmentAtom);

  const addNpubMessageContacts = React.useCallback(
    (rawNpubs: readonly string[], messageId: string) => {
      const savedNpubs = new Set(
        contacts.flatMap((contact) => {
          if (isDeletedContact(contact)) return [];
          const npub = normalizeNpubIdentifier(contact.npub ?? "");
          return npub ? [npub] : [];
        }),
      );
      const myNpub = normalizeNpubIdentifier(currentNpub ?? "");
      if (myNpub) savedNpubs.add(myNpub);

      const newNpubs: string[] = [];
      for (const rawNpub of rawNpubs) {
        const npub = normalizeNpubIdentifier(rawNpub);
        if (!npub || savedNpubs.has(npub)) continue;
        savedNpubs.add(npub);
        newNpubs.push(npub);
      }
      if (newNpubs.length === 0) return;

      const savedContactIds: ContactId[] = [];
      for (const npub of newNpubs) {
        const saved = saveNpubContact(npub);
        if (!saved) return;
        savedContactIds.push(saved.contact.id);
      }

      setPendingContactsGroupAssignment({ messageId, savedContactIds });
      setStatus(
        t("contactsSaved").replace("{count}", String(savedContactIds.length)),
      );
    },
    [
      contacts,
      currentNpub,
      saveNpubContact,
      setPendingContactsGroupAssignment,
      setStatus,
      t,
    ],
  );

  const closeContactsGroupAssignment = React.useCallback(() => {
    setPendingContactsGroupAssignment(null);
  }, [setPendingContactsGroupAssignment]);

  const assignPendingContactsToGroup = React.useCallback(
    async (rawGroup: string) => {
      const pending = pendingContactsGroupAssignment;
      if (!pending) return;

      const groups = normalizeContactGroups([rawGroup]);
      if (groups.length === 0) return;

      const groupName = NonEmptyString1000.fromUnknown(groups[0]);
      const groupNamesJson = NonEmptyString1000.fromUnknown(
        serializeContactGroups(groups),
      );
      if (!groupName.ok || !groupNamesJson.ok) {
        setStatus(`${t("errorPrefix")}: ${t("group")}`);
        return;
      }

      for (const id of pending.savedContactIds) {
        const result = await runWrite(
          contactsRepository.update(id, {
            groupName: groupName.value,
            groupNamesJson: groupNamesJson.value,
          }),
        );
        if (!result.ok) {
          setStatus(`${t("errorPrefix")}: ${result.error}`);
          return;
        }
      }

      setPendingContactsGroupAssignment(null);
      reportContactsAddedToGroup(pending, groups[0] ?? rawGroup);
      setStatus(
        t("contactsAddedToGroup")
          .replace("{count}", String(pending.savedContactIds.length))
          .replace("{group}", groups.join(", ")),
      );
    },
    [
      contactsRepository,
      pendingContactsGroupAssignment,
      setPendingContactsGroupAssignment,
      setStatus,
      t,
    ],
  );

  const contactsGroupAssignment =
    React.useMemo<MessageContactsGroupAssignment | null>(
      () =>
        pendingContactsGroupAssignment
          ? {
              messageId: pendingContactsGroupAssignment.messageId,
              contactCount:
                pendingContactsGroupAssignment.savedContactIds.length,
              groupNames,
              onAssign: assignPendingContactsToGroup,
              onDismiss: closeContactsGroupAssignment,
            }
          : null,
      [
        assignPendingContactsToGroup,
        closeContactsGroupAssignment,
        groupNames,
        pendingContactsGroupAssignment,
      ],
    );

  return { addNpubMessageContacts, contactsGroupAssignment };
};

/** Opens the new-contact form, empty or with the prefill a payment left. */
export const useOpenNewContactPage = () => {
  const registry = React.useContext(RegistryContext);
  return React.useCallback(() => {
    registry.set(payAmountAtom, "");
    const prefill = registry.get(contactNewPrefillAtom);
    registry.set(contactNewPrefillAtom, null);
    registry.update(contactFormAtom, (draft) => ({
      ...draft,
      editingId: null,
      form: prefill
        ? {
            name: prefill.suggestedName ?? "",
            npub: prefill.npub ?? "",
            lnAddress: prefill.lnAddress,
            groups: [],
          }
        : makeEmptyContactForm(),
      initial: null,
    }));
    navigateTo({ route: "contactNew" });
  }, [registry]);
};

/** Opens a contact from the list: its conversation, or its page or pay screen without an npub. */
export const useOpenContactDetail = () => {
  const contacts = useContacts();
  const openContactPay = useOpenContactPay();
  const setContactPayBackToChat = useSetNavIntent("contactPayBackToChat");
  return React.useCallback(
    (contact: {
      readonly id?: string | null;
      readonly isUnknownContact?: boolean;
    }) => {
      const contactId = (contact.id ?? "").trim();
      if (!contactId) return;

      setContactPayBackToChat(null);

      if (contact.isUnknownContact) {
        navigateTo({ route: "chat", id: contactId });
        return;
      }

      const knownContact =
        contacts.find((row) => row.id.trim() === contactId) ?? null;
      if (!knownContact) {
        navigateTo({ route: "contacts" });
        return;
      }

      const npub = (knownContact.npub ?? "").trim();
      const ln = (knownContact.lnAddress ?? "").trim();
      if (!npub) {
        if (ln) {
          openContactPay(knownContact.id);
          return;
        }
        navigateTo({ route: "contact", id: knownContact.id });
        return;
      }
      navigateTo({ route: "chat", id: knownContact.id });
    },
    [contacts, openContactPay, setContactPayBackToChat],
  );
};
