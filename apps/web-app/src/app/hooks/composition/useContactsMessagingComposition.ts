import type { ProfileMetadata } from "@linky-fit/linkstr";
import {
  ContactId,
  PositiveInt,
  type ContactsRepository,
  type ConversationsRepository,
} from "@linky-fit/linksync";
import { decodeNpub } from "@linky-fit/linkstr";
import {
  RegistryContext,
  useAtom,
  useAtomSet,
  useAtomSuspense,
  useAtomValue,
  useLinkstrCommands,
  useOutboxResults,
} from "@linky-fit/linkstr-react";
import { Effect } from "effect";
import React, { useMemo } from "react";
import { useLinkstrInspectorBridge } from "../../../devtools/inspector/useLinkstrInspectorBridge";
import { useDeferredOnlineReady } from "../../../hooks/useDeferredOnlineReady";
import { useDocumentVisible } from "../../../hooks/useDocumentVisible";
import { useLatest } from "../../../hooks/useLatest";
import { useOnline } from "../../../hooks/useOnline";
import { navigateTo, useRouting } from "../../../hooks/useRouting";
import {
  isStatusFilterValue,
  parseStatusFilterValue,
} from "../../../nostrStatus";
import {
  getProfilePictureUrl,
  loadCachedProfile,
  releaseAllAvatarObjectUrls,
} from "../../../profileCache";
import { NO_GROUP_FILTER } from "../../../utils/constants";
import { getBestNostrName } from "../../../utils/formatting";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import { setStoredPushContactNames } from "../../../utils/pushContactNamesStorage";
import { contactsToRestore } from "../../lib/chatUnread";
import { NO_WRITE, runWrite, type WriteOutcome } from "../../lib/storeWrite";
import {
  pendingUnknownContactAddAtom,
  unknownNamesAtom,
} from "../../state/contacts/chatContacts";
import { contactsCommandsAtom } from "../../state/contacts/commands";
import { unreadByContactIdAtom } from "../../state/contacts/contactsList";
import {
  contactsOnboardingHasBackedUpKeysAtom,
  contactsOnboardingHasPaidAtom,
} from "../../state/contacts/onboarding";
import { bankPaymentOfferMessagesAtom } from "../../state/messages/bankOffers";
import { chatDraftAtom } from "../../state/messages/chat";
import { messagesVisibleSinceSecAtom } from "../../state/messages/readModel";
import { currentPubkeyAtom } from "../../state/session/session";
import { seenReceiptsEnabledAtSecAtom } from "../../state/shell/devicePrefs";
import type { PaymentLogData } from "../../types/appTypes";
import {
  useContactEditor,
  useContactEditorParams,
  useContactEditorWatchers,
} from "../contacts/useContactEditor";
import { useOpenNewContactPage } from "../contacts/useContactActions";
import {
  useChatContact,
  useDisplayContacts,
  type DisplayContact,
} from "../contacts/useDisplayContacts";
import { useProfileCache } from "../contacts/useProfileCache";
import { useSaveNpubContact } from "../contacts/useSaveNpubContact";
import { useSharedProfileLink } from "../contacts/useSharedProfileLink";
import { statusFilterSummary } from "../contacts/useContactsList";
import { useChatScroll } from "../messages/chatScroll";
import { applyOutboxResult } from "../messages/outboxResults";
import type { PeerSeenWindow } from "../messages/seenReceiptInbox";
import {
  useChatSend,
  useResetChatContexts,
  withChatOffers,
} from "../messages/useChat";
import { useChatReadCursorSync } from "../messages/useChatReadCursorSync";
import { useChatSeenReceiptSync } from "../messages/useChatSeenReceiptSync";
import { useLinkstrInboxSync } from "../messages/useLinkstrInboxSync";
import { useMessagesCommands } from "../messages/useMessagesCommands";
import { useMuteListSync } from "../messages/useMuteListSync";
import { useUnknownSenderReassignment } from "../messages/useUnknownSenderReassignment";
import { useBankPaymentOffers } from "../useBankPaymentOffers";
import { useContactsDomain } from "../useContactsDomain";
import { useFeedbackContactWatcher } from "../useFeedbackContact";
import { useLinkstrConfigSync } from "../useLinkstrConfigSync";
import {
  fetchAndCacheProfiles,
  useLinkstrProfileSync,
} from "../useLinkstrProfileSync";
import {
  useAccountHydrated,
  useUnknownSendersRepository,
} from "../useLinksync";
import { useMessagesDomain } from "../useMessagesDomain";
import { usePushRegistrationLifecycle } from "../usePushRegistrationLifecycle";
import { useRelayDomain } from "../useRelayDomain";
import { useIdentityOwnersComposition } from "./useIdentityOwnersComposition";
import type { Translate } from "../../../i18n";
import type { PushToastOptions } from "../../../hooks/useToasts";

export type { DisplayContact };

const INLINE_NPUB_PATTERN =
  /(?:nostr:)?npub1[023456789acdefghjklmnpqrstuvwxyz]+(?:@npub\.cash)?/gi;

const extractMentionedNpubs = (content: string): string[] => {
  const matches = content.match(INLINE_NPUB_PATTERN);
  if (!matches) return [];

  const seen = new Set<string>();
  const npubs: string[] = [];

  for (const match of matches) {
    const npub = normalizeNpubIdentifier(match);
    if (!npub || seen.has(npub)) continue;
    seen.add(npub);
    npubs.push(npub);
  }

  return npubs;
};

type IdentityOwnersCompositionResult = ReturnType<
  typeof useIdentityOwnersComposition
>;

interface UseContactsMessagingCompositionParams {
  appOwnerId: IdentityOwnersCompositionResult["appOwnerId"];
  contactsRepository: ContactsRepository;
  conversationsRepository: ConversationsRepository;
  currentNpub: string | null;
  currentNsec: string | null;
  formatDisplayedAmountText: (amountSat: number) => string;
  isSeedLogin: boolean;
  logPayStep: (step: string, data?: PaymentLogData) => void;
  maybeShowPwaNotification: (
    title: string,
    body: string,
    tag?: string,
  ) => Promise<void>;
  pushToast: (message: string, options?: PushToastOptions) => void;
  route: ReturnType<typeof useRouting>;
  /** Receipts-enabled baseline; null means "send read receipts" is off. */
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  syncedNostrIdentityMatchesLocal: boolean;
  t: Translate;
}

/**
 * The people watchers: Nostr inbox, profile and mute-list sync, read
 * cursors and receipts, proxy payment offers, and the contact list's
 * filters. Screens read contacts, messages and drafts from the state atoms.
 */
export const useContactsMessagingComposition = ({
  appOwnerId,
  contactsRepository,
  conversationsRepository,
  currentNpub,
  currentNsec,
  formatDisplayedAmountText,
  isSeedLogin,
  logPayStep,
  maybeShowPwaNotification,
  pushToast,
  route,
  setStatus,
  syncedNostrIdentityMatchesLocal,
  t,
}: UseContactsMessagingCompositionParams) => {
  const registry = React.useContext(RegistryContext);

  const contactsOnboardingHasPaid = useAtomValue(contactsOnboardingHasPaidAtom);
  const contactsOnboardingHasBackedUpKeys = useAtomValue(
    contactsOnboardingHasBackedUpKeysAtom,
  );

  const chatOwnPubkeyHex = useAtomValue(currentPubkeyAtom);

  const {
    cache: {
      metadataByNpub: nostrMetadataByNpub,
      pictureByNpub: nostrPictureByNpub,
      statusByNpub: nostrStatusByNpub,
    },
    reset: resetProfileCache,
    setMetadataByNpub: setNostrMetadataByNpub,
    setPictureByNpub: setNostrPictureByNpub,
    setStatusByNpub: setNostrStatusByNpub,
  } = useProfileCache();

  // The cached avatar object URLs are revoked here, so no entry may keep one.
  React.useEffect(() => {
    return () => {
      releaseAllAvatarObjectUrls();
      resetProfileCache();
    };
  }, [currentNsec, resetProfileCache]);

  const setChatDraft = useAtomSet(chatDraftAtom);
  const resetChatContexts = useResetChatContexts();

  const autoAcceptedChatMessageIdsRef = React.useRef<Set<string>>(new Set());

  const activeChatRouteId = route.kind === "chat" ? route.id : "";

  React.useEffect(() => {
    if (route.kind === "chat") return;
    resetChatContexts();
  }, [resetChatContexts, route.kind]);

  React.useEffect(() => {
    if (!activeChatRouteId) return;
    resetChatContexts();
  }, [activeChatRouteId, resetChatContexts]);

  const {
    chatDidInitialScrollForContactRef,
    chatForceScrollToBottomRef,
    chatLastMessageCountRef,
    chatMessageElByIdRef,
    chatMessagesRef,
    chatScrollTargetIdRef,
    triggerChatScrollToBottom,
  } = useChatScroll();

  const nostrMetadataInFlight = React.useRef<Set<string>>(new Set());

  const accountHydrated = useAccountHydrated();
  const messagesCommands = useMessagesCommands();
  const reassignContactMessages = React.useCallback(
    (fromContactId: string, toContactId: string): Promise<number> =>
      messagesCommands?.reassignContactMessages(fromContactId, toContactId) ??
      Promise.resolve(0),
    [messagesCommands],
  );

  const { activeGroup, contacts, selectedContact, setActiveGroup } =
    useContactsDomain({
      accountHydrated,
      contacts: contactsRepository,
      noGroupFilterValue: NO_GROUP_FILTER,
      route,
    });

  const contactsLatestRef = useLatest(contacts);

  React.useEffect(() => {
    const records = [];

    for (const contact of contacts) {
      const name = (contact.name ?? "").trim();
      const npub = normalizeNpubIdentifier(contact.npub ?? "");
      if (!name || !npub) continue;

      const pubkey = decodeNpub(npub);
      if (!pubkey) continue;
      records.push({
        name,
        npub,
        pubkey,
        nameSetByUser: contact.nameSetByUser === 1,
      });
    }

    void setStoredPushContactNames(records);
  }, [contacts]);

  const unknownSendersRepository = useUnknownSendersRepository();
  const {
    appendLocalNostrMessage,
    appendLocalNostrReaction,
    chatMessages,
    latestMessages,
    nostrMessagesLocal,
    nostrMessagesRecent,
    knownReactionKeysRef,
    markLocalNostrMessageDeleted,
    nostrReactionsLocal,
    pendingPaymentsKey,
    softDeleteLocalNostrReactionsByWrapIds,
    storeRetractedReaction,
    updateLocalNostrMessage,
    updateLocalNostrReaction,
  } = useMessagesDomain({
    appOwnerId,
    chatForceScrollToBottomRef,
    chatMessagesRef,
    conversations: conversationsRepository,
    hydrated: accountHydrated,
    route,
    unknownSenders: unknownSendersRepository,
  });

  // Passive Nostr work waits for hydration, with no timeout, and for the
  // synced identity it settles: a seed login with none synced keeps its own.
  const online = useOnline();
  const nostrBootstrapReady =
    online &&
    Boolean(currentNsec) &&
    accountHydrated &&
    (!isSeedLogin || syncedNostrIdentityMatchesLocal);
  const deferredOnlineReady = useDeferredOnlineReady();
  const canRunNostrNetworkWork = deferredOnlineReady && nostrBootstrapReady;
  const { muteListSynced } = useMuteListSync({
    enabled: nostrBootstrapReady,
    pubkey: chatOwnPubkeyHex,
  });

  usePushRegistrationLifecycle({
    currentNsec,
    enabled: deferredOnlineReady,
  });

  const { relayUrls } = useRelayDomain({
    currentNpub,
    currentNsec,
    networkEnabled: canRunNostrNetworkWork,
    route,
    setStatus,
    t,
  });

  useLinkstrConfigSync({ nostrFetchRelays: relayUrls });
  useLinkstrInspectorBridge();

  useLinkstrProfileSync({
    contacts,
    contactsRepository,
    currentNpub,
    enabled: nostrBootstrapReady,
    routeKind: route.kind,
    setNostrMetadataByNpub,
    setNostrPictureByNpub,
    setNostrStatusByNpub,
  });

  const {
    applyBankPaymentOfferSnapshot,
    getBankPaymentOfferForSettlement,
    isBankPaymentOfferCanceled,
    respondToBankPaymentOfferWithGroupState,
  } = useBankPaymentOffers({
    currentNsec,
    setStatus,
    t,
  });
  const bankPaymentOfferMessages = useAtomValue(bankPaymentOfferMessagesAtom);
  const chatMessagesWithBankPaymentOffers = React.useMemo(
    () => withChatOffers(route, chatMessages, bankPaymentOfferMessages),
    [bankPaymentOfferMessages, chatMessages, route],
  );

  const [unknownNames, setUnknownNames] = useAtom(unknownNamesAtom);

  const saveNpubContact = useSaveNpubContact();

  useSharedProfileLink({
    accountHydrated,
    contacts,
    contactsRepository,
    currentNpub,
    saveNpubContact,
    setChatDraft,
    t,
  });

  const { displayContacts, unknownContacts } = useDisplayContacts();

  useUnknownSenderReassignment({
    contacts,
    hydrated: accountHydrated,
    reassign: reassignContactMessages,
    unknownSenders: unknownContacts,
  });

  const unknownContactNpubs = React.useMemo(() => {
    const seen = new Set<string>();
    const npubs: string[] = [];

    for (const contact of unknownContacts) {
      const npub = normalizeNpubIdentifier(contact.npub ?? "");
      if (!npub) continue;
      if (seen.has(npub)) continue;
      seen.add(npub);
      npubs.push(npub);
    }

    return npubs;
  }, [unknownContacts]);

  const chatMentionedNpubs = React.useMemo(() => {
    const seen = new Set<string>();
    const npubs: string[] = [];

    for (const message of chatMessages) {
      for (const npub of extractMentionedNpubs(message.content)) {
        if (seen.has(npub)) continue;
        seen.add(npub);
        npubs.push(npub);
      }
    }

    return npubs;
  }, [chatMessages]);

  const prefetchedMessageNpubs = React.useMemo(() => {
    const seen = new Set<string>();
    const npubs: string[] = [];

    for (const npub of unknownContactNpubs) {
      if (seen.has(npub)) continue;
      seen.add(npub);
      npubs.push(npub);
    }

    for (const npub of chatMentionedNpubs) {
      if (seen.has(npub)) continue;
      seen.add(npub);
      npubs.push(npub);
    }

    return npubs;
  }, [chatMentionedNpubs, unknownContactNpubs]);

  const { fetchProfiles: fetchProfilesOneShot } = useLinkstrCommands();

  // Unknown senders and mentioned npubs are not watched; a cached read or one
  // batched profile fetch feeds both their display name and avatar.
  React.useEffect(() => {
    let cancelled = false;

    const applyMetadata = (npub: string, metadata: ProfileMetadata | null) => {
      if (cancelled) return;
      const name = metadata ? getBestNostrName(metadata) : null;
      setUnknownNames((prev) =>
        prev[npub] !== undefined ? prev : { ...prev, [npub]: name },
      );
      const url = getProfilePictureUrl(metadata);
      if (url) {
        setNostrPictureByNpub((prev) =>
          npub in prev ? prev : { ...prev, [npub]: url },
        );
      }
    };

    const run = async () => {
      const uncached: string[] = [];
      for (const npub of prefetchedMessageNpubs) {
        if (unknownNames[npub] !== undefined) continue;

        const cached = loadCachedProfile(npub);
        if (cached) {
          applyMetadata(npub, cached.metadata);
          continue;
        }

        if (!nostrBootstrapReady) continue;
        if (nostrMetadataInFlight.current.has(npub)) continue;
        uncached.push(npub);
      }
      if (uncached.length === 0) return;

      for (const npub of uncached) nostrMetadataInFlight.current.add(npub);
      try {
        const fetched = await fetchAndCacheProfiles(
          fetchProfilesOneShot,
          uncached,
        );
        for (const [npub, metadata] of fetched) applyMetadata(npub, metadata);
      } finally {
        for (const npub of uncached) nostrMetadataInFlight.current.delete(npub);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    fetchProfilesOneShot,
    nostrBootstrapReady,
    prefetchedMessageNpubs,
    setNostrPictureByNpub,
    setUnknownNames,
    unknownNames,
  ]);

  const selectedChatContact = useChatContact(route);

  const { statusFilterCurrencies } = React.useMemo(
    () => statusFilterSummary(displayContacts, nostrStatusByNpub),
    [displayContacts, nostrStatusByNpub],
  );

  React.useEffect(() => {
    if (!isStatusFilterValue(activeGroup)) return;

    const selectedCurrency = parseStatusFilterValue(activeGroup);
    if (!selectedCurrency) {
      setActiveGroup(null);
      return;
    }

    if (!statusFilterCurrencies.includes(selectedCurrency)) {
      setActiveGroup(null);
    }
  }, [activeGroup, setActiveGroup, statusFilterCurrencies]);

  const messagesVisibleSinceSec = useAtomValue(messagesVisibleSinceSecAtom);
  const seenReceiptsEnabledAtSec = useAtomValue(seenReceiptsEnabledAtSecAtom);
  const unreadByContactId = useAtomValue(unreadByContactIdAtom);

  const contactEditorParams = useContactEditorParams(route);
  useContactEditorWatchers(contactEditorParams);
  const { addNewContactFromIdentifier } = useContactEditor(contactEditorParams);

  const openNewContactPage = useOpenNewContactPage();

  useOutboxResults(async (result) => {
    applyOutboxResult(result, {
      updateLocalNostrMessage,
      updateLocalNostrReaction,
    });
  });

  const contactsOnboardingHasSentMessage = useMemo(() => {
    return nostrMessagesRecent.some((m) => m.direction === "out");
  }, [nostrMessagesRecent]);

  const { restoreContact } = useAtomSuspense(contactsCommandsAtom).value;

  useFeedbackContactWatcher(contacts);

  // The in-flight set keeps the effect from repeating the write before the
  // restored row is read back.
  const restoringRef = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!accountHydrated) return;
    for (const contact of contactsToRestore(contacts, unreadByContactId)) {
      const contactId = contact.id.trim();
      if (restoringRef.current.has(contactId)) continue;
      restoringRef.current.add(contactId);
      void restoreContact(contact.id).finally(() => {
        restoringRef.current.delete(contactId);
      });
    }
  }, [accountHydrated, contacts, restoreContact, unreadByContactId]);

  // Only a contacts change re-checks the pending add, so it is read here
  // rather than subscribed to.
  React.useEffect(() => {
    const pending = registry.get(pendingUnknownContactAddAtom);
    if (!pending) return;

    const existing = contacts.find(
      (contact) =>
        normalizeNpubIdentifier(contact.npub ?? "") === pending.targetNpub &&
        Boolean(contact.id),
    );
    if (!existing?.id) return;

    registry.set(pendingUnknownContactAddAtom, null);
    void reassignContactMessages(pending.sourceContactId, existing.id);
    setStatus(t("contactSaved"));
    navigateTo({ route: "chat", id: existing.id });
  }, [contacts, reassignContactMessages, registry, setStatus, t]);

  const { sendChatMessage } = useChatSend(
    route,
    route.kind === "chat" || route.kind === "bankPaymentOffer"
      ? selectedChatContact
      : selectedContact,
  );

  const openInboxMessageToast = React.useCallback(
    (params: { contactId: string; messageId?: string }) => {
      const contactId = params.contactId.trim();
      if (!contactId) return;
      const messageId = (params.messageId ?? "").trim();

      navigateTo({ route: "chat", id: contactId });
      triggerChatScrollToBottom(messageId || undefined);
    },
    [triggerChatScrollToBottom],
  );

  const peerSeenWrittenByContactIdRef = React.useRef(
    new Map<string, PeerSeenWindow>(),
  );
  const peerSeenSentUpToSecByPubkeyRef = React.useRef(
    new Map<string, number>(),
  );

  const recordSentSeenReceipt = React.useCallback(
    (peerPubkey: string, seenUpToSec: number) => {
      const key = peerPubkey.trim();
      if (!key) return;
      const sent = peerSeenSentUpToSecByPubkeyRef.current;
      if (seenUpToSec > (sent.get(key) ?? 0)) sent.set(key, seenUpToSec);
    },
    [],
  );

  const getPeerSeenWindow = React.useCallback(
    (contactId: string): PeerSeenWindow | null => {
      const row = contactsLatestRef.current.find(
        (contact) => contact.id.trim() === contactId,
      );
      const sinceSec = row?.chatPeerSeenSinceSec ?? 0;
      const seenUpToSec = row?.chatPeerSeenAtSec ?? 0;
      const stored =
        sinceSec > 0 && seenUpToSec > sinceSec
          ? { sinceSec, seenUpToSec }
          : null;
      // The session-written window covers the gap until Evolu re-emits the row.
      const written = peerSeenWrittenByContactIdRef.current.get(contactId);
      if (!written) return stored;
      if (!stored) return written;
      return written.seenUpToSec >= stored.seenUpToSec ? written : stored;
    },
    [contactsLatestRef],
  );

  const advanceContactPeerSeen = React.useCallback(
    (contactId: string, seenWindow: PeerSeenWindow): Promise<WriteOutcome> => {
      const id = ContactId.from(contactId);
      const atSec = PositiveInt.from(seenWindow.seenUpToSec);
      if (!id.ok || !atSec.ok) return NO_WRITE;
      const sinceSec = PositiveInt.from(seenWindow.sinceSec);
      peerSeenWrittenByContactIdRef.current.set(contactId, seenWindow);
      const written = runWrite(
        Effect.flatMap(conversationsRepository.ensureDirect(id.value), (chat) =>
          conversationsRepository.setPeerSeen(chat.id, {
            sinceSec: sinceSec.ok ? sinceSec.value : null,
            atSec: atSec.value,
          }),
        ),
      );
      void written.then((outcome) => {
        if (outcome.ok) return;
        peerSeenWrittenByContactIdRef.current.delete(contactId);
        console.warn("[linky][conversations] peer seen write failed", outcome);
      });
      return written;
    },
    [conversationsRepository],
  );

  const dispatchInboxEvent = useLinkstrInboxSync({
    advanceContactPeerSeen,
    appendLocalNostrMessage,
    appendLocalNostrReaction,
    applyBankPaymentOfferSnapshot,
    contacts,
    currentNsec,
    enabled: nostrBootstrapReady && muteListSynced,
    formatDisplayedAmountText,
    getPeerSeenWindow,
    logPayStep,
    maybeShowPwaNotification,
    messagesVisibleSinceSec,
    latestMessages,
    nostrMessagesLocal,
    knownReactionKeysRef,
    nostrReactionsLocal,
    onOpenInboxMessageToast: openInboxMessageToast,
    pushToast,
    markLocalNostrMessageDeleted,
    recordSentSeenReceipt,
    route,
    softDeleteLocalNostrReactionsByWrapIds,
    storeRetractedReaction,
    t,
    updateLocalNostrMessage,
    updateLocalNostrReaction,
  });

  const documentVisible = useDocumentVisible();

  useChatReadCursorSync({
    chatMessages: chatMessagesWithBankPaymentOffers,
    conversations: conversationsRepository,
    documentVisible,
    hydrated: accountHydrated,
    route,
    selectedContact,
  });

  useChatSeenReceiptSync({
    chatMessages: chatMessagesWithBankPaymentOffers,
    documentVisible,
    seenReceiptsEnabledAtSec,
    route,
    selectedContact,
    sentUpToSecByPubkeyRef: peerSeenSentUpToSecByPubkeyRef,
  });

  return {
    addNewContactFromIdentifier,
    appendLocalNostrMessage,
    autoAcceptedChatMessageIdsRef,
    chatDidInitialScrollForContactRef,
    chatForceScrollToBottomRef,
    chatLastMessageCountRef,
    chatMessageElByIdRef,
    chatMessages,
    chatMessagesRef,
    chatMessagesWithBankPaymentOffers,
    chatScrollTargetIdRef,
    contacts,
    contactsLatestRef,
    contactsOnboardingHasBackedUpKeys,
    contactsOnboardingHasPaid,
    contactsOnboardingHasSentMessage,
    dispatchInboxEvent,
    getBankPaymentOfferForSettlement,
    isBankPaymentOfferCanceled,
    latestMessages,
    nostrBootstrapReady,
    nostrMessagesLocal,
    nostrMessagesRecent,
    nostrMetadataByNpub,
    nostrPictureByNpub,
    nostrStatusByNpub,
    openNewContactPage,
    pendingPaymentsKey,
    respondToBankPaymentOfferWithGroupState,
    saveNpubContact,
    selectedChatContact,
    selectedContact,
    sendChatMessage,
    updateLocalNostrMessage,
  };
};
