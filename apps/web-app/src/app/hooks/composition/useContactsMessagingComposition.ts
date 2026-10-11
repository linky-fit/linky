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
import React, { useMemo, useState } from "react";
import { useLinkstrInspectorBridge } from "../../../devtools/inspector/useLinkstrInspectorBridge";
import { useDeferredOnlineReady } from "../../../hooks/useDeferredOnlineReady";
import { useDocumentVisible } from "../../../hooks/useDocumentVisible";
import { useLatest } from "../../../hooks/useLatest";
import { useOnline } from "../../../hooks/useOnline";
import { navigateTo, useRouting } from "../../../hooks/useRouting";
import { type Lang } from "../../../i18n";
import {
  buildStatusFilterValue,
  parseProfileGeneralStatus,
  isStatusFilterValue,
  parseStatusFilterValue,
} from "../../../nostrStatus";
import {
  getProfilePictureUrl,
  loadCachedProfile,
  releaseAllAvatarObjectUrls,
} from "../../../profileCache";
import {
  ARCHIVED_CONTACTS_FILTER,
  CONTACTS_ONBOARDING_HAS_BACKUPED_KEYS_STORAGE_KEY,
  CONTACTS_ONBOARDING_HAS_PAID_STORAGE_KEY,
  NO_GROUP_FILTER,
} from "../../../utils/constants";
import { getContactGroups } from "../../../utils/contactGroups";
import { getBestNostrName } from "../../../utils/formatting";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import { setStoredPushContactNames } from "../../../utils/pushContactNamesStorage";
import { safeLocalStorageGet } from "../../../utils/storage";
import { getBankPaymentOfferCurrency } from "@linky-fit/proxy-payment";
import { mergeBankPaymentOffersIntoLastMessageByContactId } from "../../lib/bankPaymentOfferRows";
import {
  collectUnreadNewestIncomingByContactId,
  contactsToUnarchive,
} from "../../lib/chatUnread";
import { NO_WRITE, runWrite, type WriteOutcome } from "../../lib/storeWrite";
import {
  pendingUnknownContactAddAtom,
  unknownNamesAtom,
} from "../../state/contacts/chatContacts";
import { contactsCommandsAtom } from "../../state/contacts/commands";
import {
  contactNewPrefillAtom,
  recentlyAddedContactIdAtom,
} from "../../state/contacts/contactForm";
import { bankPaymentOfferMessagesAtom } from "../../state/messages/bankOffers";
import { chatDraftAtom } from "../../state/messages/chat";
import { messagesVisibleSinceSecAtom } from "../../state/messages/readModel";
import { currentPubkeyAtom } from "../../state/session/session";
import { payAmountAtom } from "../../state/wallet/contactPay";
import type { PaymentLogData } from "../../types/appTypes";
import {
  useContactEditor,
  useContactEditorParams,
  useContactEditorWatchers,
} from "../contacts/useContactEditor";
import {
  useCloseContactDetail,
  useOpenContactPay,
} from "../contacts/useContactActions";
import {
  useChatContact,
  useDisplayContacts,
  type DisplayContact,
} from "../contacts/useDisplayContacts";
import { useProfileCache } from "../contacts/useProfileCache";
import { useSaveNpubContact } from "../contacts/useSaveNpubContact";
import { useSharedProfileLink } from "../contacts/useSharedProfileLink";
import { useVisibleContacts } from "../contacts/useVisibleContacts";
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
import { useSetNavIntent } from "../shell/navIntents";
import { useBankPaymentOffers } from "../useBankPaymentOffers";
import { useContactsDomain } from "../useContactsDomain";
import { useFeedbackContact } from "../useFeedbackContact";
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
  lang: Lang;
  logPayStep: (step: string, data?: PaymentLogData) => void;
  maybeShowPwaNotification: (
    title: string,
    body: string,
    tag?: string,
  ) => Promise<void>;
  pushToast: (message: string, options?: PushToastOptions) => void;
  route: ReturnType<typeof useRouting>;
  /** Receipts-enabled baseline; null means "send read receipts" is off. */
  seenReceiptsEnabledAtSec: number | null;
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
  lang,
  logPayStep,
  maybeShowPwaNotification,
  pushToast,
  route,
  seenReceiptsEnabledAtSec,
  setStatus,
  syncedNostrIdentityMatchesLocal,
  t,
}: UseContactsMessagingCompositionParams) => {
  const registry = React.useContext(RegistryContext);
  const recentlyAddedContactId = useAtomValue(recentlyAddedContactIdAtom);

  const [contactsOnboardingHasPaid, setContactsOnboardingHasPaid] =
    useState<boolean>(
      () =>
        safeLocalStorageGet(CONTACTS_ONBOARDING_HAS_PAID_STORAGE_KEY) === "1",
    );

  const [
    contactsOnboardingHasBackedUpKeys,
    setContactsOnboardingHasBackedUpKeys,
  ] = useState<boolean>(
    () =>
      safeLocalStorageGet(CONTACTS_ONBOARDING_HAS_BACKUPED_KEYS_STORAGE_KEY) ===
      "1",
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

  const contactNameCollator = useMemo(
    () =>
      new Intl.Collator(lang, {
        usage: "sort",
        numeric: true,
        sensitivity: "variant",
      }),
    [lang],
  );

  const accountHydrated = useAccountHydrated();
  const messagesCommands = useMessagesCommands();
  const reassignContactMessages = React.useCallback(
    (fromContactId: string, toContactId: string): Promise<number> =>
      messagesCommands?.reassignContactMessages(fromContactId, toContactId) ??
      Promise.resolve(0),
    [messagesCommands],
  );

  const {
    activeGroup,
    contacts,
    contactsFilterOpen,
    contactsSearch,
    contactsSearchInputRef,
    contactsSearchParts,
    dedupeContacts,
    dedupeContactsIsBusy,
    groupCounts,
    groupNames,
    selectedContact,
    setActiveGroup,
    setContactsSearch,
    toggleContactsFilter,
    ungroupedCount,
  } = useContactsDomain({
    accountHydrated,
    contacts: contactsRepository,
    noGroupFilterValue: NO_GROUP_FILTER,
    pushToast,
    reassignContactMessages,
    route,
    t,
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
    lastMessageByContactId,
    latestMessages,
    nostrMessagesLocal,
    nostrMessagesRecent,
    knownReactionKeysRef,
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

  const {
    canSaveNewRelay,
    isRecommendedRelay,
    newRelayUrl,
    pendingRelayDeleteUrl,
    relayUrls,
    requestDeleteSelectedRelay,
    saveNewRelay,
    selectedRelayUrl,
    setNewRelayUrl,
  } = useRelayDomain({
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
    activeBankPaymentOfferContacts,
    applyBankPaymentOfferSnapshot,
    bankPaymentOfferRecipientCount,
    bankPaymentOfferStaggerDelaySec,
    getBankPaymentOfferForSettlement,
    isBankPaymentOfferCanceled,
    recentBankPaymentOfferOutcomesByContactId,
    requestBankPaymentOffer,
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

  const lastVisibleMessageByContactId = React.useMemo(
    () =>
      mergeBankPaymentOffersIntoLastMessageByContactId(
        lastMessageByContactId,
        bankPaymentOfferMessages,
      ),
    [bankPaymentOfferMessages, lastMessageByContactId],
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

  const { displayContactById, displayContacts, unknownContacts } =
    useDisplayContacts();

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

  const displayContactsSearchData = React.useMemo(() => {
    return displayContacts.map((contact) => {
      const idKey = (contact.id ?? "").trim();
      const groupNames = getContactGroups(contact);
      const normalizedNpub = normalizeNpubIdentifier(contact.npub ?? "");
      const statusFilterValues = normalizedNpub
        ? parseProfileGeneralStatus(nostrStatusByNpub[normalizedNpub])
            .currencies
        : [];
      const haystack = [
        contact.name,
        contact.npub,
        contact.lnAddress,
        ...groupNames,
        contact.unknownPubkeyHex,
        ...statusFilterValues,
      ]
        .map((value) => (value ?? "").trim().toLowerCase())
        .filter(Boolean)
        .join(" ");

      return {
        contact,
        idKey,
        groupNames,
        haystack,
        statusFilterValues,
      };
    });
  }, [displayContacts, nostrStatusByNpub]);

  const { statusFilterCounts, statusFilterCurrencies } = React.useMemo(() => {
    const currencyCounts = new Map<string, number>();

    for (const contact of displayContacts) {
      if ((contact.archivedAtSec ?? 0) > 0) continue;
      const normalizedNpub = normalizeNpubIdentifier(contact.npub ?? "");
      if (!normalizedNpub) continue;

      for (const currency of parseProfileGeneralStatus(
        nostrStatusByNpub[normalizedNpub],
      ).currencies) {
        currencyCounts.set(currency, (currencyCounts.get(currency) ?? 0) + 1);
      }
    }

    const currencies = [...currencyCounts.entries()]
      .sort((left, right) => {
        if (right[1] !== left[1]) return right[1] - left[1];
        return left[0].localeCompare(right[0]);
      })
      .map(([currency]) => currency);
    return {
      statusFilterCounts: currencyCounts,
      statusFilterCurrencies: currencies,
    };
  }, [displayContacts, nostrStatusByNpub]);

  const contactFilterOptions = React.useMemo(() => {
    const options: Array<{ count: number; label: string; value: string }> = [];
    if (ungroupedCount > 0) {
      options.push({
        count: ungroupedCount,
        label: t("noGroup"),
        value: NO_GROUP_FILTER,
      });
    }
    const archivedCount = displayContacts.filter(
      (contact) => (contact.archivedAtSec ?? 0) > 0,
    ).length;
    if (archivedCount > 0) {
      options.push({
        count: archivedCount,
        label: t("archiveFilter"),
        value: ARCHIVED_CONTACTS_FILTER,
      });
    }
    for (const groupName of groupNames) {
      options.push({
        count: groupCounts.get(groupName) ?? 0,
        label: groupName,
        value: groupName,
      });
    }
    for (const currency of statusFilterCurrencies) {
      options.push({
        count: statusFilterCounts.get(currency) ?? 0,
        label: currency,
        value: buildStatusFilterValue(currency),
      });
    }
    return options.sort((left, right) => {
      const leftSpecialOrder =
        left.value === ARCHIVED_CONTACTS_FILTER
          ? 2
          : left.value === NO_GROUP_FILTER
            ? 1
            : 0;
      const rightSpecialOrder =
        right.value === ARCHIVED_CONTACTS_FILTER
          ? 2
          : right.value === NO_GROUP_FILTER
            ? 1
            : 0;
      if (leftSpecialOrder !== rightSpecialOrder) {
        return leftSpecialOrder - rightSpecialOrder;
      }
      if (right.count !== left.count) return right.count - left.count;
      return left.label.localeCompare(right.label);
    });
  }, [
    displayContacts,
    groupCounts,
    groupNames,
    statusFilterCounts,
    statusFilterCurrencies,
    t,
    ungroupedCount,
  ]);

  React.useEffect(() => {
    if (activeGroup === ARCHIVED_CONTACTS_FILTER) return;
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

  const chatLastSeenAtSecByContactId = React.useMemo(() => {
    const byContactId = new Map<string, number>();
    for (const contact of contacts) {
      const contactId = contact.id.trim();
      const lastSeenAtSec = contact.chatLastSeenAtSec ?? 0;
      if (!contactId || !Number.isFinite(lastSeenAtSec) || lastSeenAtSec <= 0) {
        continue;
      }
      byContactId.set(contactId, lastSeenAtSec);
    }
    return byContactId;
  }, [contacts]);

  const messagesVisibleSinceSec = useAtomValue(messagesVisibleSinceSecAtom);
  const unreadByContactId = React.useMemo(
    () =>
      collectUnreadNewestIncomingByContactId(
        [...nostrMessagesLocal, ...bankPaymentOfferMessages],
        chatLastSeenAtSecByContactId,
        messagesVisibleSinceSec,
      ),
    [
      bankPaymentOfferMessages,
      chatLastSeenAtSecByContactId,
      messagesVisibleSinceSec,
      nostrMessagesLocal,
    ],
  );

  const visibleContacts = useVisibleContacts<DisplayContact>({
    activeGroup,
    contactNameCollator,
    contactsSearchData: displayContactsSearchData,
    contactsSearchParts,
    lastMessageByContactId: lastVisibleMessageByContactId,
    noGroupFilterValue: NO_GROUP_FILTER,
    pinnedContactId: recentlyAddedContactId,
    unreadByContactId,
  });

  const bankPaymentOfferCurrency =
    route.kind === "bankPayment"
      ? getBankPaymentOfferCurrency(route.spdPayload)
      : null;

  const bankPaymentOfferContacts = React.useMemo(() => {
    if (!bankPaymentOfferCurrency) return [];

    const sortedContacts = [
      ...visibleContacts.pinned,
      ...visibleContacts.conversations,
      ...visibleContacts.others,
    ];
    return sortedContacts.flatMap((contact) => {
      const normalizedNpub = normalizeNpubIdentifier(contact.npub ?? "");
      if (!normalizedNpub) return [];
      if (
        !parseProfileGeneralStatus(
          nostrStatusByNpub[normalizedNpub],
        ).currencies.includes(bankPaymentOfferCurrency)
      ) {
        return [];
      }

      return [
        {
          ...contact,
          pictureUrl: nostrPictureByNpub[normalizedNpub] ?? null,
          recentBankPaymentOfferOutcomes:
            recentBankPaymentOfferOutcomesByContactId.get(
              (contact.id ?? "").trim(),
            ) ?? [],
        },
      ];
    });
  }, [
    bankPaymentOfferCurrency,
    recentBankPaymentOfferOutcomesByContactId,
    nostrPictureByNpub,
    nostrStatusByNpub,
    visibleContacts.pinned,
    visibleContacts.conversations,
    visibleContacts.others,
  ]);

  const contactEditorParams = useContactEditorParams(route);
  useContactEditorWatchers(contactEditorParams);
  const { addNewContactFromIdentifier, clearContactForm, setForm } =
    useContactEditor(contactEditorParams);
  const closeContactDetail = useCloseContactDetail();

  const setPayAmount = useAtomSet(payAmountAtom);
  const [contactNewPrefill, setContactNewPrefill] = useAtom(
    contactNewPrefillAtom,
  );
  const openNewContactPage = React.useCallback(() => {
    setPayAmount("");
    clearContactForm();
    const prefill = contactNewPrefill;
    setContactNewPrefill(null);
    if (prefill) {
      setForm({
        name: prefill.suggestedName ?? "",
        npub: prefill.npub ?? "",
        lnAddress: prefill.lnAddress,
        groups: [],
      });
    }
    navigateTo({ route: "contactNew" });
  }, [
    clearContactForm,
    contactNewPrefill,
    setContactNewPrefill,
    setForm,
    setPayAmount,
  ]);

  useOutboxResults(async (result) => {
    applyOutboxResult(result, {
      updateLocalNostrMessage,
      updateLocalNostrReaction,
    });
  });

  const contactsOnboardingHasSentMessage = useMemo(() => {
    return nostrMessagesRecent.some((m) => m.direction === "out");
  }, [nostrMessagesRecent]);

  const { unarchiveContact } = useAtomSuspense(contactsCommandsAtom).value;

  const { openFeedbackContact } = useFeedbackContact<(typeof contacts)[number]>(
    { contacts, contactsRepository, pushToast, t },
  );

  // The in-flight set keeps the effect from repeating the write before the
  // restored row is read back.
  const unarchivingRef = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!accountHydrated) return;
    for (const contact of contactsToUnarchive(contacts, unreadByContactId)) {
      const contactId = contact.id.trim();
      if (unarchivingRef.current.has(contactId)) continue;
      unarchivingRef.current.add(contactId);
      void unarchiveContact(contact.id).finally(() => {
        unarchivingRef.current.delete(contactId);
      });
    }
  }, [accountHydrated, contacts, unarchiveContact, unreadByContactId]);

  const openContactPay = useOpenContactPay();
  const setContactPayBackToChat = useSetNavIntent("contactPayBackToChat");

  const openContactDetail = React.useCallback(
    (contact: DisplayContact) => {
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
    activeBankPaymentOfferContacts,
    activeGroup,
    addNewContactFromIdentifier,
    appendLocalNostrMessage,
    autoAcceptedChatMessageIdsRef,
    bankPaymentOfferContacts,
    bankPaymentOfferRecipientCount,
    bankPaymentOfferStaggerDelaySec,
    canSaveNewRelay,
    chatDidInitialScrollForContactRef,
    chatForceScrollToBottomRef,
    chatLastMessageCountRef,
    chatMessageElByIdRef,
    chatMessages,
    chatMessagesRef,
    chatMessagesWithBankPaymentOffers,
    chatScrollTargetIdRef,
    closeContactDetail,
    contactFilterOptions,
    contacts,
    contactsFilterOpen,
    contactsLatestRef,
    contactsOnboardingHasBackedUpKeys,
    contactsOnboardingHasPaid,
    contactsOnboardingHasSentMessage,
    contactsSearch,
    contactsSearchInputRef,
    dedupeContacts,
    dedupeContactsIsBusy,
    dispatchInboxEvent,
    displayContactById,
    getBankPaymentOfferForSettlement,
    groupNames,
    isBankPaymentOfferCanceled,
    isRecommendedRelay,
    lastMessageByContactId: lastVisibleMessageByContactId,
    latestMessages,
    newRelayUrl,
    nostrBootstrapReady,
    nostrMessagesLocal,
    nostrMessagesRecent,
    nostrMetadataByNpub,
    nostrPictureByNpub,
    nostrStatusByNpub,
    openContactDetail,
    openFeedbackContact,
    openNewContactPage,
    pendingPaymentsKey,
    pendingRelayDeleteUrl,
    relayUrls,
    requestBankPaymentOffer,
    requestDeleteSelectedRelay,
    respondToBankPaymentOfferWithGroupState,
    saveNewRelay,
    saveNpubContact,
    selectedChatContact,
    selectedContact,
    selectedRelayUrl,
    sendChatMessage,
    setActiveGroup,
    setContactsOnboardingHasBackedUpKeys,
    setContactsOnboardingHasPaid,
    setContactsSearch,
    setNewRelayUrl,
    statusFilterCurrencies,
    toggleContactsFilter,
    ungroupedCount,
    unreadByContactId,
    updateLocalNostrMessage,
    visibleContacts,
  };
};
