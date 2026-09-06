import {
  contactsLimitMessage,
  useSaveNpubContact,
} from "../contacts/useSaveNpubContact";
import { writeContact } from "../../lib/writeContact";
import * as Evolu from "@evolu/common";
import type { ProfileMetadata } from "@linky/linkstr";
import {
  decodeNpub,
  encodeNpub,
  identityFromNsec,
  Pubkey,
} from "@linky/linkstr";
import {
  fetchProfilesAtom,
  publishMuteListAtom,
  useAtomSet,
  useOutboxResults,
} from "@linky/linkstr-react";
import { Schema } from "effect";
import React, { useMemo, useState } from "react";
import {
  deriveDefaultProfile,
  omitSyntheticContactLightningAddress,
} from "../../../derivedProfile";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { useLinkstrInspectorBridge } from "../../../devtools/inspector/useLinkstrInspectorBridge";
import { useEvolu, type ContactId } from "../../../evolu";
import { useDeferredOnlineReady } from "../../../hooks/useDeferredOnlineReady";
import { useDocumentVisible } from "../../../hooks/useDocumentVisible";
import { useLatest } from "../../../hooks/useLatest";
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
  BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY,
  CONTACTS_ONBOARDING_HAS_BACKUPED_KEYS_STORAGE_KEY,
  CONTACTS_ONBOARDING_HAS_PAID_STORAGE_KEY,
  MAX_CONTACTS_PER_OWNER,
  NO_GROUP_FILTER,
} from "../../../utils/constants";
import {
  getContactGroups,
  normalizeContactGroups,
  serializeContactGroups,
} from "../../../utils/contactGroups";
import { formatShortNpub, getBestNostrName } from "../../../utils/formatting";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import { setStoredPushContactNames } from "../../../utils/pushContactNamesStorage";
import { getBankPaymentOfferCurrency } from "../../../utils/spdPayment";
import {
  getLastBankPaymentOfferResponseSecByContactId,
  mergeBankPaymentOffersIntoLastMessageByContactId,
} from "../../lib/bankPaymentOffer";
import { useBankPaymentOffers } from "../useBankPaymentOffers";
import { collectUnreadNewestIncomingByContactId } from "../../lib/chatUnread";
import { findUniqueContactByLightningAddress } from "../../lib/contactIdentity";
import { resolveContactRowOwnerLane } from "../../lib/contactOwnerLane";
import { buildLinkyPaymentRequestDeclineMessage } from "../../lib/paymentRequestMessage";
import {
  parsePrivateImageMessage,
  privateImagePreviewText,
} from "../../lib/privateImageMessage";
import type {
  ContactRowLike,
  LocalNostrMessage,
  PaymentLogData,
} from "../../types/appTypes";
import { useContactEditor } from "../contacts/useContactEditor";
import { useVisibleContacts } from "../contacts/useVisibleContacts";
import {
  buildUnknownContactId,
  isUnknownContactId,
  normalizePubkeyHex,
  readUnknownContactIdPubkey,
} from "../messages/contactIdentity";
import type { PeerSeenWindow } from "../messages/seenReceiptInbox";
import { useChatReadCursorSync } from "../messages/useChatReadCursorSync";
import { applyOutboxResult } from "../messages/outboxResults";
import { useChatSeenReceiptSync } from "../messages/useChatSeenReceiptSync";
import {
  useEditChatMessage,
  type EditChatContext,
} from "../messages/useEditChatMessage";
import { useLinkstrInboxSync } from "../messages/useLinkstrInboxSync";
import {
  useSendChatMessage,
  type ReplyContext,
} from "../messages/useSendChatMessage";
import { useSendReaction } from "../messages/useSendReaction";
import { useContactsDomain } from "../useContactsDomain";
import { useEvoluNostrBootstrapReady } from "../useEvoluNostrBootstrapReady";
import { useFeedbackContact } from "../useFeedbackContact";
import { useLinkstrConfigSync } from "../useLinkstrConfigSync";
import {
  fetchAndCacheProfiles,
  useLinkstrProfileSync,
} from "../useLinkstrProfileSync";
import { useMessagesDomain } from "../useMessagesDomain";
import { usePushRegistrationLifecycle } from "../usePushRegistrationLifecycle";
import { useRelayDomain } from "../useRelayDomain";
import { useIdentityOwnersComposition } from "./useIdentityOwnersComposition";
import {
  safeLocalStorageGet,
  safeLocalStorageGetJson,
  safeLocalStorageSetJson,
} from "../../../utils/storage";
import type { Translate } from "../../../i18n";

const inMemoryNostrPictureCache = new Map<string, string | null>();

const isPubkey = Schema.is(Pubkey);

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

interface UnknownChatContact extends ContactRowLike {
  id: string;
  isUnknownContact: true;
  unknownPubkeyHex: string | null;
}

export type DisplayContact = ContactRowLike & {
  isUnknownContact?: boolean;
  unknownPubkeyHex?: string | null;
};

interface ChatSelectedContact {
  chatPeerSeenAtSec?: number | null;
  chatPeerSeenSinceSec?: number | null;
  groupName?: string | null;
  id: string;
  isUnknownContact?: boolean;
  lnAddress?: string | null;
  name?: string | null;
  npub?: string | null;
  unknownPubkeyHex?: string | null;
}

const hasOwnProperty = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const encodeUnknownNpub = (pubkeyHex: string | null): string | null => {
  if (!pubkeyHex) return null;
  const pubkey = normalizePubkeyHex(pubkeyHex);
  return pubkey ? encodeNpub(Pubkey.make(pubkey)) : null;
};

type IdentityOwnersCompositionResult = ReturnType<
  typeof useIdentityOwnersComposition
>;
type EvoluMutations = ReturnType<typeof useEvolu>;

interface SavedContactRef {
  id: ContactId;
  ownerId: IdentityOwnersCompositionResult["contactsOwnerId"] | null;
}

interface PendingContactsGroupAssignment {
  messageId: string;
  savedContacts: SavedContactRef[];
}

const reportContactsAddedToGroup = (
  pending: PendingContactsGroupAssignment,
  group: string,
): void => {
  const contactIds = pending.savedContacts.map(({ id }) => id);
  reportAppLog({
    tag: "contacts.addToGroup",
    summary: `${contactIds.length} contacts from a chat message added to group "${group}"`,
    links: { contact: contactIds, message: pending.messageId },
    payload: { contactIds, group, messageId: pending.messageId },
  });
};
type NostrBootstrapParams = Parameters<typeof useEvoluNostrBootstrapReady>[0];

interface UseContactsMessagingCompositionParams {
  activeSyncedNostrIdentity: IdentityOwnersCompositionResult["activeSyncedNostrIdentity"];
  appOwnerId: IdentityOwnersCompositionResult["appOwnerId"];
  appOwnerIdRef: IdentityOwnersCompositionResult["appOwnerIdRef"];
  cashuOwnerId: IdentityOwnersCompositionResult["cashuOwnerId"];
  cashuTokensAll: NostrBootstrapParams["tokensSnapshot"];
  contactPayBackToChatRef: React.MutableRefObject<ContactId | null>;
  contactsOwnerId: IdentityOwnersCompositionResult["contactsOwnerId"];
  contactsOwnerNewContactsCount: number;
  contactsVisibleOwnerIds: IdentityOwnersCompositionResult["contactsVisibleOwnerIds"];
  copyText: (value: string) => Promise<void>;
  currentNpub: string | null;
  currentNsec: string | null;
  formatDisplayedAmountText: (amountSat: number) => string;
  historicalOwnerSetsReady: boolean;
  identityOwnerId: IdentityOwnersCompositionResult["identityOwnerId"];
  insert: EvoluMutations["insert"];
  isSeedLogin: boolean;
  lang: Lang;
  legacyIdentitiesOwnerId: IdentityOwnersCompositionResult["legacyIdentitiesOwnerId"];
  legacyMessagesIdentityOwnerId: IdentityOwnersCompositionResult["legacyMessagesIdentityOwnerId"];
  logPayStep: (step: string, data?: PaymentLogData) => void;
  maybeShowPwaNotification: (
    title: string,
    body: string,
    tag?: string,
  ) => Promise<void>;
  messagesOwnerId: IdentityOwnersCompositionResult["messagesOwnerId"];
  messagesOwnerIdRef: IdentityOwnersCompositionResult["messagesOwnerIdRef"];
  messagesVisibleOwnerIds: IdentityOwnersCompositionResult["messagesVisibleOwnerIds"];
  metaOwnerId: IdentityOwnersCompositionResult["metaOwnerId"];
  nostrIdentityRows: NostrBootstrapParams["identitiesSnapshot"];
  pushToast: (message: string) => void;
  route: ReturnType<typeof useRouting>;
  /** Receipts-enabled baseline; null means "send read receipts" is off. */
  seenReceiptsEnabledAtSec: number | null;
  setContactPaymentIntent: React.Dispatch<
    React.SetStateAction<"pay" | "request">
  >;
  setPayAmount: React.Dispatch<React.SetStateAction<string>>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  syncedNostrIdentityMatchesLocal: boolean;
  syncedNostrIdentityResolution: IdentityOwnersCompositionResult["syncedNostrIdentityResolution"];
  t: Translate;
  transactionsBootstrapSnapshot: NostrBootstrapParams["transactionsSnapshot"];
  transactionsOwnerId: IdentityOwnersCompositionResult["transactionsOwnerId"];
  update: EvoluMutations["update"];
  upsert: EvoluMutations["upsert"];
}

export const useContactsMessagingComposition = ({
  activeSyncedNostrIdentity,
  appOwnerId,
  appOwnerIdRef,
  cashuOwnerId,
  cashuTokensAll,
  contactPayBackToChatRef,
  contactsOwnerId,
  contactsOwnerNewContactsCount,
  contactsVisibleOwnerIds,
  copyText,
  currentNpub,
  currentNsec,
  formatDisplayedAmountText,
  historicalOwnerSetsReady,
  identityOwnerId,
  insert,
  isSeedLogin,
  lang,
  legacyIdentitiesOwnerId,
  legacyMessagesIdentityOwnerId,
  logPayStep,
  maybeShowPwaNotification,
  messagesOwnerId,
  messagesOwnerIdRef,
  messagesVisibleOwnerIds,
  metaOwnerId,
  nostrIdentityRows,
  pushToast,
  route,
  seenReceiptsEnabledAtSec,
  setContactPaymentIntent,
  setPayAmount,
  setStatus,
  syncedNostrIdentityMatchesLocal,
  syncedNostrIdentityResolution,
  t,
  transactionsBootstrapSnapshot,
  transactionsOwnerId,
  update,
  upsert,
}: UseContactsMessagingCompositionParams) => {
  const [pendingDeleteId, setPendingDeleteId] = useState<ContactId | null>(
    null,
  );

  const [recentlyAddedContactId, setRecentlyAddedContactId] =
    useState<ContactId | null>(null);

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

  const chatOwnPubkeyHex = React.useMemo(
    () =>
      currentNsec ? (identityFromNsec(currentNsec)?.pubkey ?? null) : null,
    [currentNsec],
  );

  const [nostrPictureByNpub, setNostrPictureByNpub] = useState<
    Record<string, string | null>
  >(() => Object.fromEntries(inMemoryNostrPictureCache.entries()));

  const [nostrStatusByNpub, setNostrStatusByNpub] = useState<
    Record<string, string | null>
  >({});

  const [nostrMetadataByNpub, setNostrMetadataByNpub] = useState<
    Record<string, ProfileMetadata | null>
  >({});

  React.useEffect(() => {
    return () => {
      releaseAllAvatarObjectUrls();
      inMemoryNostrPictureCache.clear();
    };
  }, [currentNsec]);

  const [chatDraft, setChatDraft] = useState<string>("");

  const [chatSendIsBusy, setChatSendIsBusy] = useState(false);

  const [replyContext, setReplyContext] = useState<ReplyContext | null>(null);

  const replyContextRef = React.useRef<ReplyContext | null>(null);

  const [editContext, setEditContext] = useState<EditChatContext | null>(null);

  const autoAcceptedChatMessageIdsRef = React.useRef<Set<string>>(new Set());

  const activeChatRouteId = route.kind === "chat" ? route.id : "";

  React.useEffect(() => {
    if (route.kind === "chat") return;
    setReplyContext(null);
    setEditContext(null);
  }, [route.kind]);

  React.useEffect(() => {
    if (!activeChatRouteId) return;
    setReplyContext(null);
    setEditContext(null);
  }, [activeChatRouteId]);

  React.useEffect(() => {
    replyContextRef.current = replyContext;
  }, [replyContext]);

  React.useEffect(() => {
    for (const [npub, url] of Object.entries(nostrPictureByNpub)) {
      inMemoryNostrPictureCache.set(npub, url ?? null);
    }
  }, [nostrPictureByNpub]);

  const chatMessagesRef = React.useRef<HTMLDivElement | null>(null);

  const chatMessageElByIdRef = React.useRef<Map<string, HTMLDivElement>>(
    new Map(),
  );

  const chatDidInitialScrollForContactRef = React.useRef<string | null>(null);

  const chatForceScrollToBottomRef = React.useRef(false);

  const chatScrollTargetIdRef = React.useRef<string | null>(null);

  const chatLastMessageCountRef = React.useRef<Record<string, number>>({});

  const triggerChatScrollToBottom = React.useCallback((messageId?: string) => {
    chatForceScrollToBottomRef.current = true;
    if (messageId) chatScrollTargetIdRef.current = messageId;

    const tryScroll = (attempt: number) => {
      const targetId = chatScrollTargetIdRef.current;
      if (targetId) {
        const el = chatMessageElByIdRef.current.get(targetId);
        if (el) {
          el.scrollIntoView({ block: "end" });
          return;
        }
      }

      const c = chatMessagesRef.current;
      if (c) c.scrollTop = c.scrollHeight;

      if (attempt < 6) {
        requestAnimationFrame(() => tryScroll(attempt + 1));
      }
    };

    requestAnimationFrame(() => tryScroll(0));
  }, []);

  const nostrMetadataInFlight = React.useRef<Set<string>>(new Set());

  const pendingUnknownContactAddRef = React.useRef<{
    sourceContactId: string;
    targetNpub: string;
  } | null>(null);

  const visibleMessageOwnerIds = React.useMemo(() => {
    const ids = [
      (appOwnerId ?? "").trim(),
      ...messagesVisibleOwnerIds.map((ownerId) => ownerId.trim()),
    ].filter(Boolean);
    return Array.from(new Set(ids));
  }, [appOwnerId, messagesVisibleOwnerIds]);

  const contactNameCollator = useMemo(
    () =>
      new Intl.Collator(lang, {
        usage: "sort",
        numeric: true,
        sensitivity: "variant",
      }),
    [lang],
  );

  const reassignContactMessagesRef = React.useRef<
    (fromContactId: string, toContactId: string) => number
  >(() => 0);

  const reassignContactMessages = React.useCallback(
    (fromContactId: string, toContactId: string) =>
      reassignContactMessagesRef.current(fromContactId, toContactId),
    [],
  );

  const {
    activeGroup,
    contacts,
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
    ungroupedCount,
  } = useContactsDomain({
    appOwnerId: contactsOwnerId,
    currentNsec,
    isSeedLogin,
    noGroupFilterValue: NO_GROUP_FILTER,
    pushToast,
    reassignContactMessages,
    route,
    t,
    update,
    upsert,
    visibleOwnerIds: contactsVisibleOwnerIds,
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
      records.push({ name, npub, pubkey });
    }

    void setStoredPushContactNames(records);
  }, [contacts]);

  const activeContactsOwnerContactCount = contactsOwnerNewContactsCount;

  const {
    appendLocalNostrMessage,
    appendLocalNostrReaction,
    chatMessages,
    enqueuePendingPayment,
    lastMessageByContactId,
    nostrMessagesLatestRef,
    nostrMessagesLocal,
    nostrMessagesRecent,
    nostrReactionWrapIdsRef,
    nostrReactionsLocal,
    pendingPayments,
    reactionsByMessageId,
    reassignLocalNostrMessagesContactId,
    removeLocalNostrMessagesByContactId,
    removePendingPayment,
    softDeleteLocalNostrReaction,
    softDeleteLocalNostrReactionsByWrapIds,
    updateLocalNostrMessage,
    updateLocalNostrReaction,
  } = useMessagesDomain({
    appOwnerId,
    appOwnerIdRef,
    chatForceScrollToBottomRef,
    chatMessagesRef,
    messagesOwnerId,
    messagesOwnerIdRef,
    route,
    visibleMessageOwnerIds,
  });

  const evoluOwnersReadyForNostr = isSeedLogin
    ? Boolean(
        cashuOwnerId &&
        contactsOwnerId &&
        identityOwnerId &&
        legacyIdentitiesOwnerId &&
        legacyMessagesIdentityOwnerId &&
        messagesOwnerId &&
        metaOwnerId &&
        transactionsOwnerId,
      ) && historicalOwnerSetsReady
    : Boolean(appOwnerId);

  const evoluNostrOwnerKey = React.useMemo(() => {
    if (!currentNpub || !evoluOwnersReadyForNostr) return "";

    return [
      currentNpub,
      appOwnerId,
      cashuOwnerId,
      contactsOwnerId,
      identityOwnerId,
      legacyIdentitiesOwnerId,
      legacyMessagesIdentityOwnerId,
      messagesOwnerId,
      metaOwnerId,
      transactionsOwnerId,
    ]
      .map((value) => (value ?? "").trim())
      .filter(Boolean)
      .join("|");
  }, [
    appOwnerId,
    cashuOwnerId,
    contactsOwnerId,
    currentNpub,
    evoluOwnersReadyForNostr,
    identityOwnerId,
    legacyIdentitiesOwnerId,
    legacyMessagesIdentityOwnerId,
    messagesOwnerId,
    metaOwnerId,
    transactionsOwnerId,
  ]);

  const nostrIdentityBootstrapReady =
    Boolean(activeSyncedNostrIdentity) &&
    !syncedNostrIdentityResolution.shouldMigrateLegacyIdentity &&
    syncedNostrIdentityMatchesLocal;

  const [
    missingSyncedIdentityFallbackKey,
    setMissingSyncedIdentityFallbackKey,
  ] = React.useState("");

  React.useEffect(() => {
    if (!isSeedLogin || !evoluNostrOwnerKey || activeSyncedNostrIdentity) {
      setMissingSyncedIdentityFallbackKey("");
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setMissingSyncedIdentityFallbackKey(evoluNostrOwnerKey);
    }, 8_000);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeSyncedNostrIdentity, evoluNostrOwnerKey, isSeedLogin]);

  const identityBootstrapReady = isSeedLogin
    ? nostrIdentityBootstrapReady ||
      missingSyncedIdentityFallbackKey === evoluNostrOwnerKey
    : true;

  const nostrBootstrapReady = useEvoluNostrBootstrapReady({
    contactsSnapshot: contacts,
    enabled: Boolean(currentNsec),
    identitiesSnapshot: nostrIdentityRows,
    identityReady: identityBootstrapReady,
    messagesSnapshot: nostrMessagesLocal,
    ownerKey: evoluNostrOwnerKey,
    reactionsSnapshot: nostrReactionsLocal,
    tokensSnapshot: cashuTokensAll,
    transactionsSnapshot: transactionsBootstrapSnapshot,
  });
  const deferredOnlineReady = useDeferredOnlineReady();
  const canRunNostrNetworkWork = deferredOnlineReady && nostrBootstrapReady;

  usePushRegistrationLifecycle({
    currentNsec,
    enabled: deferredOnlineReady,
  });

  const {
    canSaveNewRelay,
    newRelayUrl,
    nostrFetchRelays,
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

  useLinkstrConfigSync({ currentNsec, nostrFetchRelays });
  useLinkstrInspectorBridge();

  useLinkstrProfileSync({
    contacts,
    contactsOwnerId,
    contactsVisibleOwnerIds,
    currentNpub,
    enabled: nostrBootstrapReady,
    routeKind: route.kind,
    setNostrMetadataByNpub,
    setNostrPictureByNpub,
    setNostrStatusByNpub,
    update,
  });

  const {
    bankPaymentOfferMessages,
    bankPaymentOfferRecipientCount,
    bankPaymentOfferStaggerDelaySec,
    chatMessagesWithBankPaymentOffers,
    isBankPaymentOfferCanceled,
    reassignBankPaymentOfferMessages,
    requestBankPaymentOffer,
    respondToBankPaymentOfferWithGroupState,
    upsertBankPaymentOfferMessage,
  } = useBankPaymentOffers({
    chatMessages,
    contacts,
    currentNpub,
    currentNsec,
    route,
    setStatus,
    t,
  });

  const reassignNostrConversationContactId = React.useCallback(
    (fromContactId: string, toContactId: string): number => {
      const normalizedFrom = fromContactId.trim();
      const normalizedTo = toContactId.trim();
      if (!normalizedFrom || !normalizedTo || normalizedFrom === normalizedTo) {
        return 0;
      }

      const movedMessageCount = reassignLocalNostrMessagesContactId(
        normalizedFrom,
        normalizedTo,
      );
      reassignBankPaymentOfferMessages(normalizedFrom, normalizedTo);
      return movedMessageCount;
    },
    [reassignBankPaymentOfferMessages, reassignLocalNostrMessagesContactId],
  );

  reassignContactMessagesRef.current = reassignNostrConversationContactId;

  const lastVisibleMessageByContactId = React.useMemo(
    () =>
      mergeBankPaymentOffersIntoLastMessageByContactId(
        lastMessageByContactId,
        bankPaymentOfferMessages,
      ),
    [bankPaymentOfferMessages, lastMessageByContactId],
  );

  const [contactNewPrefill, setContactNewPrefill] = React.useState<null | {
    lnAddress: string;
    npub: string | null;
    suggestedName: string | null;
  }>(null);

  const [unknownNameByNpub, setUnknownNameByNpub] = useState<
    Record<string, string | null>
  >({});

  const buildUnknownDisplayName = React.useCallback(
    (name: string | null, npub: string | null) => {
      const prefix = t("unknownContactNamePrefix");
      const normalizedName = (name ?? "").trim();
      const fallback = npub ? formatShortNpub(npub) : t("unknownContactTitle");
      return `${prefix} ${normalizedName || fallback}`.trim();
    },
    [t],
  );

  const buildSavedContactName = React.useCallback(
    (name: string | null, npub: string | null) => {
      const normalizedName = (name ?? "").trim();
      return (
        normalizedName ||
        (npub ? formatShortNpub(npub) : t("unknownContactTitle"))
      );
    },
    [t],
  );

  const saveNpubContact = useSaveNpubContact({
    contacts,
    contactsOwnerId,
    activeContactsOwnerContactCount,
    buildSavedContactName,
    unknownNameByNpub,
    insert,
    lang,
    setStatus,
    t,
  });

  const unknownContacts = React.useMemo<UnknownChatContact[]>(() => {
    const blockedPubkeys = new Set(
      safeLocalStorageGetJson(
        BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY,
        Schema.Array(Schema.String),
        [],
      )
        .map((entry) => normalizePubkeyHex(entry))
        .filter((entry): entry is string => Boolean(entry)),
    );

    const unknownById = new Map<string, UnknownChatContact>();

    for (const [contactId, lastMessage] of lastVisibleMessageByContactId) {
      const normalizedContactId = contactId.trim();
      if (!normalizedContactId) continue;
      if (!isUnknownContactId(normalizedContactId)) continue;

      const candidatePubkeyFromLast = normalizePubkeyHex(lastMessage.pubkey);
      const candidatePubkeyFromId =
        readUnknownContactIdPubkey(normalizedContactId);
      const candidatePubkeyFromThread = nostrMessagesLocal
        .filter((message) => message.contactId.trim() === normalizedContactId)
        .map((message) => normalizePubkeyHex(message.pubkey))
        .find((pubkey) => {
          if (!pubkey) return false;
          if (blockedPubkeys.has(pubkey)) return false;
          const ownPubkey = normalizePubkeyHex(chatOwnPubkeyHex);
          if (ownPubkey && ownPubkey === pubkey) return false;
          return true;
        });

      const unknownPubkeyHex =
        candidatePubkeyFromId ??
        candidatePubkeyFromThread ??
        candidatePubkeyFromLast ??
        null;
      if (unknownPubkeyHex && blockedPubkeys.has(unknownPubkeyHex)) continue;
      const ownPubkey = normalizePubkeyHex(chatOwnPubkeyHex);
      if (unknownPubkeyHex && ownPubkey && unknownPubkeyHex === ownPubkey) {
        continue;
      }

      const unknownNpub = encodeUnknownNpub(unknownPubkeyHex);
      const bestName = unknownNpub
        ? (unknownNameByNpub[unknownNpub] ?? null)
        : null;

      unknownById.set(normalizedContactId, {
        id: normalizedContactId,
        name: buildUnknownDisplayName(bestName, unknownNpub),
        npub: unknownNpub,
        lnAddress: null,
        groupName: null,
        isUnknownContact: true,
        unknownPubkeyHex,
      });
    }

    return Array.from(unknownById.values());
  }, [
    buildUnknownDisplayName,
    chatOwnPubkeyHex,
    lastVisibleMessageByContactId,
    nostrMessagesLocal,
    unknownNameByNpub,
  ]);

  React.useEffect(() => {
    // The lightning-address match guesses identity and writes an npub, so it
    // only considers active contacts; a direct npub match also reclaims
    // threads of archived contacts.
    const activeContacts = contacts.filter((contact) => {
      const archivedAtSec = contact.archivedAtSec ?? 0;
      return !Number.isFinite(archivedAtSec) || archivedAtSec <= 0;
    });

    for (const unknownContact of unknownContacts) {
      const unknownContactId = unknownContact.id.trim();
      const unknownNpub = normalizeNpubIdentifier(unknownContact.npub ?? "");
      if (!unknownContactId || !unknownNpub) continue;

      let knownContact = contacts.find((contact) => {
        const knownContactId = contact.id.trim();
        if (!knownContactId || knownContactId === unknownContactId) {
          return false;
        }
        return normalizeNpubIdentifier(contact.npub ?? "") === unknownNpub;
      });

      let matchedByLightningAddress = false;
      let matchedMetadata: ProfileMetadata | null = null;
      if (!knownContact) {
        matchedMetadata = loadCachedProfile(unknownNpub)?.metadata ?? null;
        const profileLightningAddress = matchedMetadata
          ? omitSyntheticContactLightningAddress(
              (matchedMetadata.lud16 ?? "").trim() ||
                (matchedMetadata.lud06 ?? "").trim(),
              unknownNpub,
            )
          : "";
        const lightningContact = findUniqueContactByLightningAddress(
          activeContacts,
          profileLightningAddress,
        );
        if (lightningContact) {
          knownContact = lightningContact;
          matchedByLightningAddress = true;
        }
      }

      const knownContactId = (knownContact?.id ?? "").trim();
      if (!knownContactId) continue;

      if (matchedByLightningAddress && knownContact) {
        const bestName = matchedMetadata
          ? getBestNostrName(matchedMetadata)
          : null;
        const parsedNpub = Evolu.NonEmptyString1000.fromUnknown(unknownNpub);
        if (!parsedNpub.ok) continue;
        const parsedName = bestName
          ? Evolu.NonEmptyString1000.fromUnknown(bestName)
          : null;
        const ownerId =
          resolveContactRowOwnerLane(knownContact, contactsVisibleOwnerIds) ??
          contactsOwnerId;
        const payload = {
          id: knownContact.id,
          npub: parsedNpub.value,
          ...(!(knownContact.name ?? "").trim() && parsedName?.ok
            ? { name: parsedName.value }
            : {}),
        };
        const result = writeContact(update, payload, ownerId);
        if (!result.ok) continue;
      }

      reassignNostrConversationContactId(unknownContactId, knownContactId);
    }
  }, [
    contacts,
    contactsOwnerId,
    contactsVisibleOwnerIds,
    reassignNostrConversationContactId,
    unknownContacts,
    update,
  ]);

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

  const fetchProfilesOneShot = useAtomSet(fetchProfilesAtom, {
    mode: "promiseExit",
  });

  // Unknown senders and mentioned npubs are not watched; a cached read or one
  // batched profile fetch feeds both their display name and avatar.
  React.useEffect(() => {
    let cancelled = false;

    const applyMetadata = (npub: string, metadata: ProfileMetadata | null) => {
      if (cancelled) return;
      const name = metadata ? getBestNostrName(metadata) : null;
      setUnknownNameByNpub((prev) =>
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
        if (unknownNameByNpub[npub] !== undefined) continue;

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
    unknownNameByNpub,
  ]);

  const displayContacts = React.useMemo<DisplayContact[]>(() => {
    return [...contacts, ...unknownContacts];
  }, [contacts, unknownContacts]);

  const displayContactById = React.useMemo(() => {
    const byId = new Map<string, DisplayContact>();
    for (const contact of displayContacts) {
      const id = (contact.id ?? "").trim();
      if (!id) continue;
      byId.set(id, contact);
    }
    return byId;
  }, [displayContacts]);

  const selectedChatContact = React.useMemo<ChatSelectedContact | null>(() => {
    if (route.kind !== "chat" && route.kind !== "bankPaymentOffer") return null;

    const chatId = (route.kind === "chat" ? route.id : route.chatId).trim();
    if (!chatId) return null;

    const source = displayContactById.get(chatId) ?? null;
    if (!source) return null;

    const normalizedId = (source.id ?? "").trim();
    if (!normalizedId) return null;

    const normalizedNpub = normalizeNpubIdentifier(source.npub ?? "");
    const normalizedUnknownPubkeyHex = normalizePubkeyHex(
      source.unknownPubkeyHex,
    );
    const sourceGroupName = (source.groupName ?? "").trim();
    const isUnknownContact = source.isUnknownContact === true;

    return {
      id: normalizedId,
      ...(sourceGroupName ? { groupName: sourceGroupName } : {}),
      ...(source.name !== undefined
        ? { name: (source.name ?? "").trim() || null }
        : {}),
      ...(source.lnAddress !== undefined
        ? { lnAddress: (source.lnAddress ?? "").trim() || null }
        : {}),
      ...(normalizedNpub ? { npub: normalizedNpub } : {}),
      ...(normalizedUnknownPubkeyHex
        ? { unknownPubkeyHex: normalizedUnknownPubkeyHex }
        : {}),
      ...(isUnknownContact ? { isUnknownContact: true } : {}),
      ...(selectedContact?.chatPeerSeenSinceSec != null &&
      selectedContact.chatPeerSeenAtSec != null
        ? {
            chatPeerSeenSinceSec: selectedContact.chatPeerSeenSinceSec,
            chatPeerSeenAtSec: selectedContact.chatPeerSeenAtSec,
          }
        : {}),
    };
  }, [displayContactById, route, selectedContact]);

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

  const unreadByContactId = React.useMemo(
    () =>
      collectUnreadNewestIncomingByContactId(
        [...nostrMessagesLocal, ...bankPaymentOfferMessages],
        chatLastSeenAtSecByContactId,
      ),
    [
      bankPaymentOfferMessages,
      chatLastSeenAtSecByContactId,
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

  const lastBankPaymentOfferResponseSecByContactId = React.useMemo(
    () =>
      getLastBankPaymentOfferResponseSecByContactId(bankPaymentOfferMessages),
    [bankPaymentOfferMessages],
  );

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
          lastBankPaymentResponseSec:
            lastBankPaymentOfferResponseSecByContactId.get(
              (contact.id ?? "").trim(),
            ) ?? null,
          pictureUrl: nostrPictureByNpub[normalizedNpub] ?? null,
        },
      ];
    });
  }, [
    bankPaymentOfferCurrency,
    lastBankPaymentOfferResponseSecByContactId,
    nostrPictureByNpub,
    nostrStatusByNpub,
    visibleContacts.pinned,
    visibleContacts.conversations,
    visibleContacts.others,
  ]);

  const selectedContactNpub = normalizeNpubIdentifier(
    selectedContact?.npub ?? "",
  );
  // Memoized for identity stability: the cache fallback would otherwise
  // produce a fresh object every render and retrigger effects downstream.
  const selectedContactMetadata = React.useMemo(() => {
    if (!selectedContactNpub) return undefined;
    if (hasOwnProperty(nostrMetadataByNpub, selectedContactNpub)) {
      return nostrMetadataByNpub[selectedContactNpub];
    }
    return loadCachedProfile(selectedContactNpub)?.metadata ?? undefined;
  }, [nostrMetadataByNpub, selectedContactNpub]);

  const {
    addNewContactFromIdentifier,
    addNewContactFromSearchResult,
    clearContactForm,
    contactEditsSavable,
    contactSuggestions,
    editingId,
    form,
    handleSaveContact,
    isSavingContact,
    openScannedContactPendingNpubRef,
    selectedContactPublicProfile,
    resetEditedContactFieldFromNostr,
    searchNewContact,
    setForm,
  } = useContactEditor({
    activeOwnerContactsCount: activeContactsOwnerContactCount,
    appOwnerId: contactsOwnerId,
    contactNewPrefill,
    contacts,
    currentNpub,
    insert,
    route,
    selectedContactMetadata,
    selectedContact,
    setContactNewPrefill,
    setPendingDeleteId,
    setRecentlyAddedContactId,
    setStatus,
    t,
    transactionsOwnerId,
    update,
    upsert,
  });

  const closeContactDetail = React.useCallback(() => {
    clearContactForm();
    setPendingDeleteId(null);
    navigateTo({ route: "contacts" });
  }, [clearContactForm]);

  const openNewContactPage = React.useCallback(() => {
    if (activeContactsOwnerContactCount >= MAX_CONTACTS_PER_OWNER) {
      const message = contactsLimitMessage(t);
      pushToast(message);
      return;
    }

    setPendingDeleteId(null);
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
    activeContactsOwnerContactCount,
    clearContactForm,
    contactNewPrefill,
    pushToast,
    setContactNewPrefill,
    setForm,
    setPayAmount,
    t,
  ]);

  const canAddContact =
    activeContactsOwnerContactCount < MAX_CONTACTS_PER_OWNER;

  useOutboxResults(async (result) => {
    applyOutboxResult(result, {
      updateLocalNostrMessage,
      updateLocalNostrReaction,
    });
  });

  const contactsOnboardingHasSentMessage = useMemo(() => {
    return nostrMessagesRecent.some((m) => m.direction === "out");
  }, [nostrMessagesRecent]);

  const handleDelete = (id: ContactId) => {
    const normalizedContactId = id.trim();
    const contactToArchive =
      contacts.find((contact) => contact.id.trim() === normalizedContactId) ??
      null;

    const archivedAtSec = Math.ceil(Date.now() / 1e3);
    const storedContactOwnerId = contactToArchive
      ? resolveContactRowOwnerLane(contactToArchive, contactsVisibleOwnerIds)
      : null;
    const archiveOwnerId = storedContactOwnerId ?? contactsOwnerId;
    // Archiving marks the conversation read; the messages stay on this contact
    // and a newer incoming message restores it from the archive.
    const payload = {
      id,
      archivedAtSec,
      chatLastSeenAtSec: Math.max(
        archivedAtSec,
        (contactToArchive?.chatLastSeenAtSec ?? 0) || 0,
      ),
    };
    const result = writeContact(update, payload, archiveOwnerId);
    if (result.ok) {
      setStatus(t("contactArchived"));
      closeContactDetail();
      return;
    }
    setStatus(`${t("errorPrefix")}: ${String(result.error)}`);
  };

  const unarchiveContact = React.useCallback(
    (id: ContactId) => {
      const contactToRestore =
        contacts.find((contact) => contact.id === id) ?? null;
      const storedContactOwnerId = contactToRestore
        ? resolveContactRowOwnerLane(contactToRestore, contactsVisibleOwnerIds)
        : null;
      const restoreOwnerId = storedContactOwnerId ?? contactsOwnerId;
      const result = writeContact(
        update,
        { id, archivedAtSec: null },
        restoreOwnerId,
      );

      if (result.ok) {
        const restoredNpub = normalizeNpubIdentifier(
          contactToRestore?.npub ?? "",
        );
        if (restoredNpub) {
          const unknownContactId = buildUnknownContactId(
            decodeNpub(restoredNpub),
          );
          if (unknownContactId) {
            reassignNostrConversationContactId(unknownContactId, id);
          }
        }
      }
      return result;
    },
    [
      contacts,
      contactsOwnerId,
      contactsVisibleOwnerIds,
      reassignNostrConversationContactId,
      update,
    ],
  );

  const restoreArchivedContact = React.useCallback(
    (id: ContactId) => {
      const result = unarchiveContact(id);
      if (result.ok) {
        setStatus(t("contactRestored"));
        closeContactDetail();
        return;
      }
      setStatus(`${t("errorPrefix")}: ${String(result.error)}`);
    },
    [closeContactDetail, setStatus, t, unarchiveContact],
  );

  const publishMuteList = useAtomSet(publishMuteListAtom, {
    mode: "promiseExit",
  });

  const blockPubkeyAndPublishMuteList = React.useCallback(
    async (pubkeyHex: string): Promise<boolean> => {
      const normalizedPubkey = normalizePubkeyHex(pubkeyHex);
      if (!normalizedPubkey) return false;

      const mergedBlockedPubkeys = Array.from(
        new Set(
          safeLocalStorageGetJson(
            BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY,
            Schema.Array(Schema.String),
            [],
          )
            .map((entry) => normalizePubkeyHex(entry))
            .filter((entry): entry is string => Boolean(entry))
            .concat(normalizedPubkey),
        ),
      );

      safeLocalStorageSetJson(
        BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY,
        mergedBlockedPubkeys,
      );

      // Local blocklist applies either way; the mute list is best effort.
      if (currentNsec) {
        void publishMuteList(mergedBlockedPubkeys.filter(isPubkey));
      }

      return true;
    },
    [currentNsec, publishMuteList],
  );

  const requestDeleteCurrentContact = () => {
    if (!editingId) return;
    if (pendingDeleteId === editingId) {
      setPendingDeleteId(null);
      handleDelete(editingId);
      return;
    }
    setPendingDeleteId(editingId);
  };

  const { openFeedbackContact } = useFeedbackContact<(typeof contacts)[number]>(
    {
      appOwnerId: contactsOwnerId,
      contacts,
      insert,
      pushToast,
      t,
      update,
    },
  );

  // An incoming message newer than the archive brings the contact back.
  React.useEffect(() => {
    for (const contact of contacts) {
      const archivedAtSec = contact.archivedAtSec ?? 0;
      if (!Number.isFinite(archivedAtSec) || archivedAtSec <= 0) continue;
      const contactId = contact.id.trim();
      if (!contactId) continue;
      const newestIncomingAtSec = unreadByContactId.get(contactId) ?? 0;
      if (newestIncomingAtSec <= archivedAtSec) continue;
      unarchiveContact(contact.id);
    }
  }, [contacts, unarchiveContact, unreadByContactId]);

  const blockArchivedContact = React.useCallback(async () => {
    if (route.kind !== "contactEdit") return;
    if (!selectedContact?.id) return;

    const normalizedNpub = normalizeNpubIdentifier(selectedContact.npub ?? "");
    if (!normalizedNpub) {
      setStatus(t("chatMissingContactNpub"));
      return;
    }

    const confirmed = window.confirm(t("chatUnknownContactBlockConfirm"));
    if (!confirmed) return;

    const blockedPubkey = decodeNpub(normalizedNpub);

    if (!blockedPubkey) {
      setStatus(t("chatMissingContactNpub"));
      return;
    }

    await blockPubkeyAndPublishMuteList(blockedPubkey);

    const contactId = selectedContact.id.trim();
    if (contactId) {
      removeLocalNostrMessagesByContactId(contactId);
    }

    const ownerId =
      resolveContactRowOwnerLane(selectedContact, contactsVisibleOwnerIds) ??
      contactsOwnerId;
    const result = writeContact(
      update,
      { id: selectedContact.id, isDeleted: Evolu.sqliteTrue },
      ownerId,
    );

    if (result.ok) {
      setStatus(t("contactBlocked"));
      closeContactDetail();
      return;
    }

    setStatus(`${t("errorPrefix")}: ${String(result.error)}`);
  }, [
    contactsVisibleOwnerIds,
    blockPubkeyAndPublishMuteList,
    closeContactDetail,
    contactsOwnerId,
    removeLocalNostrMessagesByContactId,
    route.kind,
    selectedContact,
    setStatus,
    t,
    update,
  ]);

  const openContactPay = React.useCallback(
    (
      contactId: string,
      fromChat = false,
      intent: "pay" | "request" = "pay",
    ) => {
      const knownContact =
        contacts.find((row) => row.id.trim() === contactId) ?? null;
      if (!knownContact) return;

      contactPayBackToChatRef.current = fromChat ? knownContact.id : null;
      setContactPaymentIntent(intent);
      navigateTo({ route: "contactPay", id: knownContact.id });
    },
    [contactPayBackToChatRef, contacts, setContactPaymentIntent],
  );

  const openContactDetail = React.useCallback(
    (contact: DisplayContact) => {
      const contactId = (contact.id ?? "").trim();
      if (!contactId) return;

      setPendingDeleteId(null);
      contactPayBackToChatRef.current = null;

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
    [contactPayBackToChatRef, contacts, openContactPay],
  );

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
      reassignNostrConversationContactId(contactId, saved.contact.id);
      setStatus(t("contactSaved"));
      navigateTo({ route: "chat", id: saved.contact.id });
      return;
    }
    pendingUnknownContactAddRef.current = {
      sourceContactId: contactId,
      targetNpub: npub,
    };
  }, [
    reassignNostrConversationContactId,
    route.kind,
    saveNpubContact,
    selectedChatContact,
    setStatus,
    t,
  ]);

  const blockUnknownContactFromChat = React.useCallback(async () => {
    if (route.kind !== "chat") return;
    if (!selectedChatContact?.isUnknownContact) return;

    const confirmed = window.confirm(t("chatUnknownContactBlockConfirm"));
    if (!confirmed) return;

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

  const getNpubMessageContactInfo = React.useCallback(
    (rawNpub: string) => {
      const npub = normalizeNpubIdentifier(rawNpub);
      if (!npub) return null;

      const knownContact =
        contacts.find(
          (contact) => normalizeNpubIdentifier(contact.npub ?? "") === npub,
        ) ?? null;
      const derivedProfile = deriveDefaultProfile(npub, lang);
      const displayName = buildSavedContactName(
        (knownContact?.name ?? "").trim() || unknownNameByNpub[npub] || null,
        npub,
      );
      const pictureUrl =
        nostrPictureByNpub[npub] ?? derivedProfile.pictureUrl ?? null;

      return {
        displayName,
        isSaved:
          Boolean(knownContact) ||
          normalizeNpubIdentifier(currentNpub ?? "") === npub,
        npub,
        pictureUrl,
      };
    },
    [
      buildSavedContactName,
      unknownNameByNpub,
      contacts,
      currentNpub,
      lang,
      nostrPictureByNpub,
    ],
  );

  const mentionContacts = React.useMemo(
    () =>
      contacts.flatMap((contact) => {
        const name = (contact.name ?? "").trim();
        const npub = normalizeNpubIdentifier(contact.npub ?? "");
        if (!name || !npub) return [];
        const groupName = (contact.groupName ?? "").trim();
        const groupNames = getContactGroups(contact);
        return [
          {
            name,
            npub,
            groupName: groupName || null,
            groupNames,
            statusNames: parseProfileGeneralStatus(nostrStatusByNpub[npub])
              .currencies,
          },
        ];
      }),
    [contacts, nostrStatusByNpub],
  );

  const openNpubMessageContact = React.useCallback(
    (rawNpub: string) => {
      const npub = normalizeNpubIdentifier(rawNpub);
      if (!npub) return;

      const existing = contacts.find(
        (contact) => normalizeNpubIdentifier(contact.npub ?? "") === npub,
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
      openScannedContactPendingNpubRef.current = saved.npub;
      setStatus(t("contactSaved"));
    },
    [
      contacts,
      currentNpub,
      openScannedContactPendingNpubRef,
      saveNpubContact,
      setStatus,
      t,
    ],
  );

  const [pendingContactsGroupAssignment, setPendingContactsGroupAssignment] =
    React.useState<PendingContactsGroupAssignment | null>(null);

  const addNpubMessageContacts = React.useCallback(
    (rawNpubs: readonly string[], messageId: string) => {
      const savedNpubs = new Set(
        contacts.flatMap((contact) => {
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

      if (
        activeContactsOwnerContactCount + newNpubs.length >
        MAX_CONTACTS_PER_OWNER
      ) {
        setStatus(contactsLimitMessage(t));
        return;
      }

      const savedContacts: SavedContactRef[] = [];
      for (const npub of newNpubs) {
        const saved = saveNpubContact(npub);
        if (!saved) return;
        savedContacts.push({ id: saved.contact.id, ownerId: saved.ownerId });
      }

      setPendingContactsGroupAssignment({ messageId, savedContacts });
      setStatus(
        t("contactsSaved").replace("{count}", String(savedContacts.length)),
      );
    },
    [
      activeContactsOwnerContactCount,
      contacts,
      currentNpub,
      saveNpubContact,
      setStatus,
      t,
    ],
  );

  const closeContactsGroupAssignment = React.useCallback(() => {
    setPendingContactsGroupAssignment(null);
  }, []);

  const assignPendingContactsToGroup = React.useCallback(
    (rawGroup: string) => {
      const pending = pendingContactsGroupAssignment;
      if (!pending) return;

      const groups = normalizeContactGroups([rawGroup]);
      if (groups.length === 0) return;

      const groupName = Evolu.NonEmptyString1000.fromUnknown(groups[0]);
      const groupNamesJson = Evolu.NonEmptyString1000.fromUnknown(
        serializeContactGroups(groups),
      );
      if (!groupName.ok || !groupNamesJson.ok) {
        setStatus(`${t("errorPrefix")}: ${t("group")}`);
        return;
      }

      for (const { id, ownerId } of pending.savedContacts) {
        const payload = {
          id,
          groupName: groupName.value,
          groupNamesJson: groupNamesJson.value,
        };
        const result = writeContact(update, payload, ownerId);
        if (!result.ok) {
          setStatus(`${t("errorPrefix")}: ${String(result.error ?? "")}`);
          return;
        }
      }

      setPendingContactsGroupAssignment(null);
      reportContactsAddedToGroup(pending, groups[0] ?? rawGroup);
      setStatus(
        t("contactsAddedToGroup")
          .replace("{count}", String(pending.savedContacts.length))
          .replace("{group}", groups.join(", ")),
      );
    },
    [pendingContactsGroupAssignment, setStatus, t, update],
  );

  React.useEffect(() => {
    const pending = pendingUnknownContactAddRef.current;
    if (!pending) return;

    const existing = contacts.find(
      (contact) =>
        normalizeNpubIdentifier(contact.npub ?? "") === pending.targetNpub &&
        Boolean(contact.id),
    );
    if (!existing?.id) return;

    pendingUnknownContactAddRef.current = null;
    reassignNostrConversationContactId(pending.sourceContactId, existing.id);
    setStatus(t("contactSaved"));
    navigateTo({ route: "chat", id: existing.id });
  }, [contacts, reassignNostrConversationContactId, setStatus, t]);

  const sendChatMessage = useSendChatMessage({
    appendLocalNostrMessage,
    chatDraft,
    chatSendIsBusy,
    currentNsec,
    route,
    replyContext,
    replyContextRef,
    selectedContact:
      route.kind === "chat" || route.kind === "bankPaymentOffer"
        ? selectedChatContact
        : selectedContact,
    setReplyContext,
    setChatDraft,
    setChatSendIsBusy,
    setStatus,
    t,
    triggerChatScrollToBottom,
    updateLocalNostrMessage,
  });

  const editChatMessage = useEditChatMessage({
    chatDraft,
    chatSendIsBusy,
    currentNsec,
    editContext,
    route,
    selectedContact: selectedChatContact,
    setChatDraft,
    setChatSendIsBusy,
    setEditContext,
    setStatus,
    t,
    updateLocalNostrMessage,
  });

  const sendReaction = useSendReaction({
    appendLocalNostrReaction,
    currentNsec,
    reactionsByMessageId,
    route,
    selectedContact: selectedChatContact,
    setStatus,
    softDeleteLocalNostrReaction,
    t,
    updateLocalNostrReaction,
  });

  const sendChatOrEditMessage = React.useCallback(async () => {
    if (editContext) {
      await editChatMessage();
      return;
    }
    await sendChatMessage();
  }, [editChatMessage, editContext, sendChatMessage]);

  const sendChatImage = React.useCallback(
    async (file: File, replyToMessage?: LocalNostrMessage) => {
      if (editContext) return;
      const replyToId = (replyToMessage?.rumorId ?? "").trim();
      await sendChatMessage({
        clearDraft: false,
        imageFile: file,
        ...(replyToId
          ? {
              replyContext: {
                replyToId,
                rootMessageId:
                  (replyToMessage?.rootMessageId ?? "").trim() || replyToId,
                replyToContent: (replyToMessage?.content ?? "").trim() || null,
              },
            }
          : {}),
      });
    },
    [editContext, sendChatMessage],
  );

  const onReplyToChatMessage = React.useCallback(
    (message: LocalNostrMessage) => {
      const rumorId = (message.rumorId ?? "").trim();
      if (!rumorId) return;
      setEditContext(null);
      setReplyContext({
        replyToId: rumorId,
        rootMessageId: (message.rootMessageId ?? "").trim() || rumorId,
        replyToContent: message.content.trim() || null,
      });
    },
    [],
  );

  const onEditChatMessage = React.useCallback((message: LocalNostrMessage) => {
    const isOut = message.direction === "out";
    if (!isOut) return;
    const rumorId = (message.rumorId ?? "").trim();
    if (!rumorId) return;
    const messageId = message.id.trim();
    if (!messageId) return;

    setReplyContext(null);
    const content = message.content;
    setEditContext({
      messageId,
      rumorId,
      originalContent: (message.originalContent ?? "").trim() || content || "",
    });
    setChatDraft(content);
  }, []);

  const onReactToChatMessage = React.useCallback(
    (message: LocalNostrMessage, emoji: string) => {
      const messageRumorId = (message.rumorId ?? "").trim();
      const messageAuthorPubkey = message.pubkey.trim();
      if (!messageRumorId || !messageAuthorPubkey) return;
      void sendReaction({
        emoji,
        messageAuthorPubkey,
        messageRumorId,
        targetKind: parsePrivateImageMessage(message.content)
          ? "image"
          : "text",
      });
    },
    [sendReaction],
  );

  const onCopyChatMessage = React.useCallback(
    (message: LocalNostrMessage) => {
      const content = message.content;
      const privateImage = parsePrivateImageMessage(content);
      const copyContent = privateImage
        ? privateImagePreviewText(t, privateImage)
        : content;
      void copyText(copyContent);
    },
    [copyText, t],
  );

  const onDeclineChatPaymentRequest = React.useCallback(
    async (message: LocalNostrMessage) => {
      const requestRumorId = (message.rumorId ?? "").trim();
      if (!requestRumorId) return;

      await sendChatMessage({
        clearDraft: false,
        replyContext: {
          replyToId: requestRumorId,
          rootMessageId: (message.rootMessageId ?? "").trim() || requestRumorId,
          replyToContent: message.content.trim() || null,
        },
        text: buildLinkyPaymentRequestDeclineMessage(requestRumorId),
      });
    },
    [sendChatMessage],
  );

  const onCancelReply = React.useCallback(() => {
    setReplyContext(null);
  }, []);

  const onCancelEdit = React.useCallback(() => {
    setEditContext(null);
    setChatDraft("");
  }, []);

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
    (contactId: string, seenWindow: PeerSeenWindow) => {
      const row = contactsLatestRef.current.find(
        (contact) => contact.id.trim() === contactId,
      );
      if (!row) return;
      const ownerId =
        resolveContactRowOwnerLane(row, contactsVisibleOwnerIds) ??
        contactsOwnerId;
      const payload = {
        id: row.id,
        chatPeerSeenSinceSec: seenWindow.sinceSec,
        chatPeerSeenAtSec: seenWindow.seenUpToSec,
      };
      const result = writeContact(update, payload, ownerId);
      if (result.ok) {
        peerSeenWrittenByContactIdRef.current.set(contactId, seenWindow);
      }
    },
    [contactsLatestRef, contactsOwnerId, contactsVisibleOwnerIds, update],
  );

  const dispatchInboxEvent = useLinkstrInboxSync({
    advanceContactPeerSeen,
    appendLocalNostrMessage,
    appendLocalNostrReaction,
    bankPaymentOfferMessages,
    contacts,
    currentNsec,
    enabled: nostrBootstrapReady,
    formatDisplayedAmountText,
    getPeerSeenWindow,
    logPayStep,
    maybeShowPwaNotification,
    nostrMessagesLatestRef,
    nostrMessagesLocal,
    nostrReactionWrapIdsRef,
    nostrReactionsLocal,
    onBankPaymentOfferMessage: upsertBankPaymentOfferMessage,
    onOpenInboxMessageToast: openInboxMessageToast,
    pushToast,
    recordSentSeenReceipt,
    route,
    softDeleteLocalNostrReactionsByWrapIds,
    t,
    updateLocalNostrMessage,
    updateLocalNostrReaction,
  });

  const documentVisible = useDocumentVisible();

  useChatReadCursorSync({
    chatMessages: chatMessagesWithBankPaymentOffers,
    contactsOwnerId,
    contactsVisibleOwnerIds,
    documentVisible,
    route,
    selectedContact,
    update,
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
    saveNpubContact,
    activeGroup,
    addNewContactFromIdentifier,
    addNewContactFromSearchResult,
    addNpubMessageContacts,
    addUnknownContactFromChat,
    appendLocalNostrMessage,
    assignPendingContactsToGroup,
    closeContactsGroupAssignment,
    pendingContactsGroupAssignment,
    autoAcceptedChatMessageIdsRef,
    bankPaymentOfferContacts,
    bankPaymentOfferMessages,
    bankPaymentOfferRecipientCount,
    bankPaymentOfferStaggerDelaySec,
    blockArchivedContact,
    blockUnknownContactFromChat,
    canAddContact,
    canSaveNewRelay,
    chatDidInitialScrollForContactRef,
    chatDraft,
    chatForceScrollToBottomRef,
    chatLastMessageCountRef,
    chatMessageElByIdRef,
    chatMessages,
    chatMessagesRef,
    chatMessagesWithBankPaymentOffers,
    chatOwnPubkeyHex,
    chatScrollTargetIdRef,
    chatSendIsBusy,
    closeContactDetail,
    contactEditsSavable,
    contactFilterOptions,
    contactSuggestions,
    contacts,
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
    editContext,
    editingId,
    enqueuePendingPayment,
    form,
    getNpubMessageContactInfo,
    groupNames,
    handleSaveContact,
    isBankPaymentOfferCanceled,
    isSavingContact,
    lastMessageByContactId: lastVisibleMessageByContactId,
    mentionContacts,
    newRelayUrl,
    nostrBootstrapReady,
    nostrMessagesLocal,
    nostrMessagesRecent,
    nostrMetadataByNpub,
    nostrPictureByNpub,
    nostrStatusByNpub,
    onCancelEdit,
    onCancelReply,
    onCopyChatMessage,
    onDeclineChatPaymentRequest,
    onEditChatMessage,
    onReactToChatMessage,
    onReplyToChatMessage,
    openContactDetail,
    openContactPay,
    openFeedbackContact,
    openNewContactPage,
    openNpubMessageContact,
    openScannedContactPendingNpubRef,
    pendingDeleteId,
    pendingPayments,
    pendingRelayDeleteUrl,
    reactionsByMessageId,
    relayUrls,
    removePendingPayment,
    replyContext,
    requestBankPaymentOffer,
    requestDeleteCurrentContact,
    requestDeleteSelectedRelay,
    resetEditedContactFieldFromNostr,
    respondToBankPaymentOfferWithGroupState,
    restoreArchivedContact,
    saveNewRelay,
    searchNewContact,
    selectedChatContact,
    selectedContact,
    selectedContactPublicProfile,
    selectedRelayUrl,
    sendChatImage,
    sendChatMessage,
    sendChatOrEditMessage,
    setActiveGroup,
    setChatDraft,
    setContactNewPrefill,
    setContactsOnboardingHasBackedUpKeys,
    setContactsOnboardingHasPaid,
    setContactsSearch,
    setForm,
    setNewRelayUrl,
    setPendingDeleteId,
    statusFilterCurrencies,
    ungroupedCount,
    unreadByContactId,
    updateLocalNostrMessage,
    visibleContacts,
  };
};
