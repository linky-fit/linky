import { useLatest } from "../../../hooks/useLatest";
import * as Evolu from "@evolu/common";
import { useQuery } from "@evolu/react";
import {
  CashuTokenText,
  ClientId,
  decodeNpub,
  encodeNprofile,
  encodeNpub,
  identityFromNsec,
  OutboxRef,
  PaymentNoticeDraft,
  parsePubkey,
  Pubkey,
  TokenMessageDraft,
} from "@linky/linkstr";
import {
  enqueueOutboxAtom,
  sendPaymentNoticeAtom,
  useAtomSet,
} from "@linky/linkstr-react";
import { decodeTokenText } from "@linky/linkshu";
import { Cause, Either, Exit, Option, Schema } from "effect";
import React, { useMemo, useState } from "react";
import {
  evolu,
  useEvolu,
  type CashuTokenRow,
  type CashuTokenId,
  type ContactId,
} from "../../../evolu";
import { navigateTo, useRouting } from "../../../hooks/useRouting";
import {
  inferLightningAddressFromLnurlTarget,
  redeemLnurlWithdraw,
  type LnurlWithdrawPreview,
} from "../../../lnurlPay";
import { NOSTR_RELAYS } from "../../../utils/nostrRelays";
import {
  CASHU_ONBOARDING_SET_MAIN_MINT_STORAGE_KEY,
  CONTACTS_ONBOARDING_HAS_PAID_STORAGE_KEY,
  WALLET_WARNING_BALANCE_THRESHOLD_SAT,
  WALLET_WARNING_DISMISSED_STORAGE_KEY,
} from "../../../utils/constants";
import { formatDisplayAmountParts } from "../../../utils/displayAmounts";
import {
  isNpubCashDisabled,
  NPUB_CASH_SERVER_BASE_URL,
} from "../../../utils/npubCashServer";
import {
  getLightningInvoicePreview,
  type LightningInvoicePreview,
} from "@linky/linkshu";
import {
  CASHU_DEFAULT_MINT_OVERRIDE_STORAGE_KEY,
  formatMintHost,
  MAIN_MINT_URL,
  normalizeMintUrl,
} from "../../../utils/mint";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import { parseNpubCashProfileInfo } from "../../../utils/npubCashInfo";
import {
  getInitialLightningInvoiceAutoPayLimit,
  getInitialPayWithCashuEnabled,
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
} from "../../../utils/storage";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import { makeLocalId } from "../../../utils/validation";
import { useCashuTokenChecks } from "../cashu/useCashuTokenChecks";
import { useNpubCashClaim } from "../cashu/useNpubCashClaim";
import { useRestoreMissingTokens } from "../cashu/useRestoreMissingTokens";
import { useSaveCashuFromText } from "../cashu/useSaveCashuFromText";
import { normalizePubkeyHex } from "../messages/contactIdentity";
import { useNpubCashMintSelection } from "../mint/useNpubCashMintSelection";
import { useContactPayMethod } from "../payments/useContactPayMethod";
import { usePayContactWithCashuMessage } from "../payments/usePayContactWithCashuMessage";
import { useRouteAmountResetEffects } from "../payments/useRouteAmountResetEffects";
import { useTopupFlow } from "../topup/useTopupFlow";
import { useAnonymousPaymentTelemetry } from "../useAnonymousPaymentTelemetry";
import { useCashuDomain } from "../useCashuDomain";
import { useLightningPaymentsDomain } from "../useLightningPaymentsDomain";
import { useMintDomain } from "../useMintDomain";
import { useOwnerScopedStorage } from "../useOwnerScopedStorage";
import { usePaidOverlayState } from "../usePaidOverlayState";
import { usePaymentsDomain } from "../usePaymentsDomain";
import { useProfileNpubCashEffects } from "../useProfileNpubCashEffects";
import { getLinkyBankPaymentOfferInfo } from "../../lib/bankPaymentOffer";
import { isCashuRowCandidateBetter } from "../../lib/cashuRowPreference";
import { readCashuTokenAliases as readCashuRowAliases } from "../../lib/cashuTokenIdentity";
import { reportCashuSendRowForgotten } from "../../lib/cashuSendInspector";
import { describeTaggedCashuError } from "../../lib/cashuStoredError";
import {
  isCashuTokenDefinitivelySpent,
  isCashuTokenEmittedState,
  isCashuTokenIssuedState,
  isCashuTokenReservedState,
} from "../../lib/cashuTokenState";
import {
  canOfferPaymentMintMelt,
  getPaymentMintMeltPlan,
} from "../../lib/paymentMintMelt";
import { selectSendMintForAmount } from "../../lib/paymentMintSelection";
import {
  buildCashuPaymentRequestMessage,
  parseCashuPaymentRequestMessage,
  type CashuPaymentRequestMessageInfo,
} from "../../lib/paymentRequestMessage";
import { getCashuTokenMessageInfo as getCashuTokenMessageInfoBase } from "../../lib/tokenMessageInfo";
import { extractCashuTokenMeta } from "../../lib/tokenText";
import type {
  ContactRowLike,
  LocalNostrMessage,
  PaymentLogData,
} from "../../types/appTypes";
import {
  useContactsMessagingComposition,
  type DisplayContact,
} from "./useContactsMessagingComposition";
import { useIdentityOwnersComposition } from "./useIdentityOwnersComposition";
import { drainLegacyAcceptedCashuToken } from "../../migrations/legacyAcceptedTokenDrain";
import { seedLinkshuSeenMintsFromTokenRows } from "../../migrations/linkshuStorageMigration";
import { useLinkshuComposition } from "./useLinkshuComposition";
import { useResumeOnLaunchAndOnline } from "../useResumeOnLaunchAndOnline";
import { useProfileComposition } from "./useProfileComposition";
import type { Translate } from "../../../i18n";

import { reportAppLog } from "../../../devtools/inspector/appLog";
const isPubkey = Schema.is(Pubkey);
const CashuTokenIdFromUnknown = Evolu.id("CashuToken");
const decodeCashuTokenText = Schema.decodeUnknownEither(CashuTokenText);

export const logPayStep = (step: string, data?: PaymentLogData): void => {
  const clientId = data?.clientId;
  const messageId = data?.messageId;
  reportAppLog({
    tag: "pay.step",
    summary: `Contact payment: ${step}`,
    links: {
      ...(typeof clientId === "string" ? { client: clientId } : {}),
      ...(typeof messageId === "string" ? { message: messageId } : {}),
    },
    payload: { step, ...data },
  });
};

type IdentityOwnersCompositionResult = ReturnType<
  typeof useIdentityOwnersComposition
>;
type ContactsMessagingCompositionResult = ReturnType<
  typeof useContactsMessagingComposition
>;
type ProfileCompositionResult = ReturnType<typeof useProfileComposition>;
type OwnerScopedStorageResult = ReturnType<typeof useOwnerScopedStorage>;
type EvoluMutations = ReturnType<typeof useEvolu>;

interface UseCashuWalletCompositionParams {
  cashuTokensAll: readonly CashuTokenRow[];
  contactPayBackToChatRef: React.MutableRefObject<ContactId | null>;
  contactsMessaging: Pick<
    ContactsMessagingCompositionResult,
    | "saveNpubContact"
    | "appendLocalNostrMessage"
    | "chatMessages"
    | "contacts"
    | "enqueuePendingPayment"
    | "isBankPaymentOfferCanceled"
    | "nostrBootstrapReady"
    | "nostrMessagesLocal"
    | "nostrMessagesRecent"
    | "nostrPictureByNpub"
    | "openScannedContactPendingNpubRef"
    | "pendingPayments"
    | "removePendingPayment"
    | "respondToBankPaymentOfferWithGroupState"
    | "selectedChatContact"
    | "selectedContact"
    | "sendChatMessage"
    | "setContactsOnboardingHasPaid"
    | "updateLocalNostrMessage"
  >;
  formatDisplayedAmountParts: (
    amountSat: number,
  ) => ReturnType<typeof formatDisplayAmountParts>;
  formatDisplayedAmountText: (amountSat: number) => string;
  identity: Pick<
    IdentityOwnersCompositionResult,
    | "appOwnerId"
    | "appOwnerIdRef"
    | "cashuOwnerId"
    | "cashuOwnerIdRef"
    | "cashuVisibleOwnerIds"
    | "currentNpub"
    | "currentNsec"
    | "isSeedLogin"
    | "metaOwnerId"
    | "transactionsOwnerId"
  >;
  maybeShowPwaNotification: (
    title: string,
    body: string,
    tag?: string,
  ) => Promise<void>;
  ownerScopedStorage: Pick<
    OwnerScopedStorageResult,
    | "logPaymentEvent"
    | "makeLocalStorageKey"
    | "migrateLegacyPaymentEventsToEvolu"
    | "readSeenMintsFromStorage"
    | "rememberSeenMint"
  >;
  payAmount: string;
  profile: Pick<
    ProfileCompositionResult,
    | "npubCashInfoInFlightRef"
    | "npubCashInfoLoadedAtMsRef"
    | "npubCashInfoLoadedForNpubRef"
    | "setIsProfileEditing"
    | "setMyProfileQr"
    | "setOwnedProfileLightningAddresses"
    | "setOwnedProfileLightningAddressesLoading"
  >;
  pushToast: (message: string) => void;
  route: ReturnType<typeof useRouting>;
  setContactPaymentIntent: React.Dispatch<
    React.SetStateAction<"pay" | "request">
  >;
  setPayAmount: React.Dispatch<React.SetStateAction<string>>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
  update: EvoluMutations["update"];
  upsert: EvoluMutations["upsert"];
}

export const useCashuWalletComposition = ({
  cashuTokensAll,
  contactPayBackToChatRef,
  contactsMessaging,
  formatDisplayedAmountParts,
  formatDisplayedAmountText,
  identity,
  maybeShowPwaNotification,
  ownerScopedStorage,
  payAmount,
  profile,
  pushToast,
  route,
  setContactPaymentIntent,
  setPayAmount,
  setStatus,
  t,
  update,
  upsert,
}: UseCashuWalletCompositionParams) => {
  const enqueueOutbox = useAtomSet(enqueueOutboxAtom, {
    mode: "promiseExit",
  });
  const sendPaymentNotice = useAtomSet(sendPaymentNoticeAtom, {
    mode: "promiseExit",
  });
  const {
    appOwnerId,
    appOwnerIdRef,
    cashuOwnerId,
    cashuOwnerIdRef,
    cashuVisibleOwnerIds,
    currentNpub,
    currentNsec,
    isSeedLogin,
    metaOwnerId,
    transactionsOwnerId,
  } = identity;
  const {
    saveNpubContact,
    appendLocalNostrMessage,
    chatMessages,
    contacts,
    enqueuePendingPayment,
    isBankPaymentOfferCanceled,
    nostrBootstrapReady,
    nostrMessagesLocal,
    nostrMessagesRecent,
    nostrPictureByNpub,
    openScannedContactPendingNpubRef,
    pendingPayments,
    removePendingPayment,
    respondToBankPaymentOfferWithGroupState,
    selectedChatContact,
    selectedContact,
    sendChatMessage,
    setContactsOnboardingHasPaid,
    updateLocalNostrMessage,
  } = contactsMessaging;
  const {
    npubCashInfoInFlightRef,
    npubCashInfoLoadedAtMsRef,
    npubCashInfoLoadedForNpubRef,
    setIsProfileEditing,
    setMyProfileQr,
    setOwnedProfileLightningAddresses,
    setOwnedProfileLightningAddressesLoading,
  } = profile;
  const {
    logPaymentEvent,
    makeLocalStorageKey,
    migrateLegacyPaymentEventsToEvolu,
    readSeenMintsFromStorage,
    rememberSeenMint,
  } = ownerScopedStorage;

  const hasMintOverrideRef = React.useRef(false);

  const [pendingCashuDeleteId, setPendingCashuDeleteId] =
    useState<CashuTokenId | null>(null);
  const [pendingMintDeleteUrl, setPendingMintDeleteUrl] = useState<
    string | null
  >(null);

  const [payWithCashuEnabled, setPayWithCashuEnabled] = useState<boolean>(() =>
    getInitialPayWithCashuEnabled(),
  );
  const [lightningInvoiceAutoPayLimit, setLightningInvoiceAutoPayLimit] =
    useState<number>(() => getInitialLightningInvoiceAutoPayLimit());

  useAnonymousPaymentTelemetry({
    appOwnerId,
    makeLocalStorageKey,
  });

  React.useEffect(() => {
    appOwnerIdRef.current = appOwnerId;
    if (!appOwnerId) return;
    const overrideKey = makeLocalStorageKey(
      CASHU_DEFAULT_MINT_OVERRIDE_STORAGE_KEY,
    );
    const overrideRaw = safeLocalStorageGet(overrideKey);
    const override = normalizeMintUrl(overrideRaw);
    const shouldSeedMainMint =
      safeLocalStorageGet(CASHU_ONBOARDING_SET_MAIN_MINT_STORAGE_KEY) === "1";

    if (!override && shouldSeedMainMint) {
      const seededMint = normalizeMintUrl(MAIN_MINT_URL);
      if (seededMint) {
        safeLocalStorageSet(overrideKey, seededMint);
        safeLocalStorageRemove(CASHU_ONBOARDING_SET_MAIN_MINT_STORAGE_KEY);
        hasMintOverrideRef.current = true;
        setDefaultMintUrl(seededMint);
        setDefaultMintUrlDraft(seededMint);
        // Mirror the onboarding-seeded value into Evolu so a brand-new
        // account converges to cashu.cz across devices even before the user
        // touches the mint UI.
        upsertDefaultMintToOwnerMetaRef.current(seededMint);
        return;
      }
    }

    if (override) {
      hasMintOverrideRef.current = true;
      setDefaultMintUrl(override);
      setDefaultMintUrlDraft(override);
    } else {
      if (shouldSeedMainMint) {
        safeLocalStorageRemove(CASHU_ONBOARDING_SET_MAIN_MINT_STORAGE_KEY);
      }
      hasMintOverrideRef.current = false;
    }
  }, [appOwnerId, appOwnerIdRef, makeLocalStorageKey]);

  const [cashuDraft, setCashuDraft] = useState("");
  const cashuDraftRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [cashuEmitAmount, setCashuEmitAmount] = useState("");
  const [cashuIsBusy, setCashuIsBusy] = useState(false);
  const [cashuBulkCheckIsBusy, setCashuBulkCheckIsBusy] = useState(false);
  const [tokensRestoreIsBusy, setTokensRestoreIsBusy] = useState(false);

  const cashuOpQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const enqueueCashuOp = React.useCallback(
    <T>(op: () => Promise<T>): Promise<T> => {
      const next = cashuOpQueueRef.current.then(op, op);
      cashuOpQueueRef.current = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    [],
  );

  const [defaultMintUrl, setDefaultMintUrl] = useState<string | null>(null);
  const [defaultMintUrlDraft, setDefaultMintUrlDraft] = useState<string>("");

  const [lnAddressPayAmount, setLnAddressPayAmount] = useState<string>("");

  const [pendingCashuTokenContactPickId, setPendingCashuTokenContactPickId] =
    useState<CashuTokenId | null>(null);

  const [
    pendingLightningInvoiceConfirmation,
    setPendingLightningInvoiceConfirmation,
  ] = useState<LightningInvoicePreview | null>(null);
  const [
    pendingLnurlWithdrawConfirmation,
    setPendingLnurlWithdrawConfirmation,
  ] = useState<LnurlWithdrawPreview | null>(null);
  const [
    pendingPaymentMintMeltConfirmation,
    setPendingPaymentMintMeltConfirmation,
  ] = useState<{
    fromMint: string;
    toMint: string;
  } | null>(null);
  const meltLargestForeignMintToMainMintRef = React.useRef<() => Promise<void>>(
    async () => {},
  );
  const [lnurlWithdrawIsBusy, setLnurlWithdrawIsBusy] = useState(false);

  const npubCashClaimInFlightRef = React.useRef(false);
  const npubCashMintSyncRef = React.useRef<string | null>(null);

  const {
    paidOverlayIsOpen,
    paidOverlayTitle,
    showPaidOverlay,
    topupPaidNavTimerRef,
  } = usePaidOverlayState({
    t,
  });

  // Default mint cross-tab + cross-device sync via Evolu `ownerMeta`.
  //
  // Background: the per-owner localStorage override
  // (`linky.cashu.defaultMintOverride.v1.<owner>`) is tab-local, so other
  // tabs (and other devices) don't see the change until reload. ownerMeta is
  // an Evolu lane that already propagates via BroadcastChannel (same-origin
  // tabs, instant) and via the Evolu sync server (other devices), so we
  // mirror the default-mint value into it.
  const ownerMetaDefaultMintRowId = React.useMemo(
    () => Evolu.createIdFromString<"OwnerMeta">("owner-pointer-defaultMint"),
    [],
  );

  const ownerMetaDefaultMintQuery = useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("ownerMeta")
          .selectAll()
          .where("isDeleted", "is not", Evolu.sqliteTrue)
          .where("scope", "=", Evolu.NonEmptyString100.orThrow("defaultMint")),
      ),
    [],
  );
  const ownerMetaDefaultMintRows = useQuery(ownerMetaDefaultMintQuery);

  const ownerMetaDefaultMintValue = React.useMemo(() => {
    for (const row of ownerMetaDefaultMintRows) {
      if (typeof row !== "object" || row === null) continue;
      if (!("value" in row)) continue;
      const raw = (row.value ?? "").trim();
      if (!raw) continue;
      const cleaned = normalizeMintUrl(raw);
      if (cleaned) return cleaned;
    }
    return null;
  }, [ownerMetaDefaultMintRows]);

  // ownerMeta -> local state: when another tab/device wrote a different
  // default mint, pick it up here. This is the ONLY direction watched as an
  // effect. A symmetric `defaultMintUrl -> ownerMeta` watcher would
  // ping-pong with the remote: in the same render where this effect queues
  // setDefaultMintUrl(remoteValue), the symmetric effect would read the
  // STALE local `defaultMintUrl` and upsert it back, racing with the remote
  // value. Two devices in this state oscillate every few ms (visible in
  // ownerMeta CRDT history). Explicit pushes happen instead from
  // `upsertDefaultMintToOwnerMeta` called by user actions and the seed
  // effect.
  React.useEffect(() => {
    if (!ownerMetaDefaultMintValue) return;
    if (!appOwnerId) return;
    const current = normalizeMintUrl(defaultMintUrl ?? "");
    if (current === ownerMetaDefaultMintValue) return;
    setDefaultMintUrl(ownerMetaDefaultMintValue);
    setDefaultMintUrlDraft(ownerMetaDefaultMintValue);
    hasMintOverrideRef.current = true;
    try {
      const overrideKey = makeLocalStorageKey(
        CASHU_DEFAULT_MINT_OVERRIDE_STORAGE_KEY,
      );
      safeLocalStorageSet(overrideKey, ownerMetaDefaultMintValue);
    } catch {
      // ignore
    }
  }, [
    appOwnerId,
    defaultMintUrl,
    makeLocalStorageKey,
    ownerMetaDefaultMintValue,
  ]);

  const upsertDefaultMintToOwnerMeta = React.useCallback(
    (mintUrl: string | null | undefined) => {
      if (!metaOwnerId) return;
      const cleaned = normalizeMintUrl(mintUrl ?? "");
      if (!cleaned) return;
      if (cleaned === ownerMetaDefaultMintValue) return;
      upsert(
        "ownerMeta",
        {
          id: ownerMetaDefaultMintRowId,
          scope: Evolu.NonEmptyString100.orThrow("defaultMint"),
          value: Evolu.NonEmptyString1000.orThrow(cleaned),
        },
        { ownerId: metaOwnerId },
      );
    },
    [metaOwnerId, ownerMetaDefaultMintRowId, ownerMetaDefaultMintValue, upsert],
  );

  const upsertDefaultMintToOwnerMetaRef = React.useRef(
    upsertDefaultMintToOwnerMeta,
  );
  React.useEffect(() => {
    upsertDefaultMintToOwnerMetaRef.current = upsertDefaultMintToOwnerMeta;
  }, [upsertDefaultMintToOwnerMeta]);

  const resolveOwnerIdForWrite = React.useCallback(async () => {
    if (cashuOwnerIdRef.current) return cashuOwnerIdRef.current;
    if (isSeedLogin) return null;
    try {
      const owner = await evolu.appOwner;
      return owner?.id ?? null;
    } catch {
      return null;
    }
  }, [cashuOwnerIdRef, isSeedLogin]);

  React.useEffect(() => {
    if (!appOwnerId) return;
    migrateLegacyPaymentEventsToEvolu(appOwnerId, transactionsOwnerId);
  }, [appOwnerId, migrateLegacyPaymentEventsToEvolu, transactionsOwnerId]);

  useRouteAmountResetEffects({
    contactPayBackToChatRef,
    routeKind: route.kind,
    setContactPaymentIntent,
    setLnAddressPayAmount,
    setPayAmount,
  });

  const topupRecipientNprofile = React.useMemo(() => {
    const pubkey = decodeNpub(currentNpub ?? "");
    return pubkey ? encodeNprofile(pubkey, NOSTR_RELAYS) : null;
  }, [currentNpub]);

  const activeCashuOwnerId = (cashuOwnerId ?? "").trim();
  const visibleCashuOwnerIds = React.useMemo(
    () =>
      new Set(
        cashuVisibleOwnerIds.map((ownerId) => ownerId.trim()).filter(Boolean),
      ),
    [cashuVisibleOwnerIds],
  );
  const dedupeVisibleCashuRows = React.useCallback(
    function dedupeVisibleCashuRows(
      rows: readonly CashuTokenRow[],
    ): CashuTokenRow[] {
      if (visibleCashuOwnerIds.size === 0) return [];

      const ownerRank = new Map<string, number>();
      let rank = 0;
      for (const normalizedOwnerId of visibleCashuOwnerIds) {
        if (!normalizedOwnerId || ownerRank.has(normalizedOwnerId)) continue;
        ownerRank.set(normalizedOwnerId, rank);
        rank += 1;
      }

      const canonicalByAlias = new Map<string, string>();
      const bestByCanonical = new Map<string, CashuTokenRow>();
      const readRowCandidates = (row: CashuTokenRow): string[] => [
        row.id,
        ...readCashuRowAliases(row),
      ];

      const isCandidateBetter = (
        candidate: CashuTokenRow,
        existing: CashuTokenRow,
      ): boolean => {
        return isCashuRowCandidateBetter({
          activeOwnerId: activeCashuOwnerId,
          candidate,
          existing,
          ownerRank,
        });
      };

      for (const row of rows) {
        const ownerId = row.ownerId;
        if (!visibleCashuOwnerIds.has(ownerId)) continue;

        const rowCandidates = readRowCandidates(row);
        if (rowCandidates.length === 0) continue;

        const canonicalKey =
          rowCandidates.find((candidate) => canonicalByAlias.has(candidate)) ??
          rowCandidates[0];
        const existing = bestByCanonical.get(canonicalKey);

        if (!existing || isCandidateBetter(row, existing)) {
          bestByCanonical.set(canonicalKey, row);
        }

        for (const candidate of rowCandidates) {
          canonicalByAlias.set(candidate, canonicalKey);
        }
      }

      return rows.filter((row) => {
        const rowCandidates = readRowCandidates(row);
        if (rowCandidates.length === 0) return false;

        const canonicalKey =
          rowCandidates.find((candidate) => canonicalByAlias.has(candidate)) ??
          rowCandidates[0];
        return bestByCanonical.get(canonicalKey) === row;
      });
    },
    [activeCashuOwnerId, visibleCashuOwnerIds],
  );

  const cashuTokensAllFiltered = React.useMemo(() => {
    return dedupeVisibleCashuRows(cashuTokensAll);
  }, [cashuTokensAll, dedupeVisibleCashuRows]);

  const cashuTokensFiltered = React.useMemo(
    () => cashuTokensAllFiltered.filter((row) => !row.isDeleted),
    [cashuTokensAllFiltered],
  );

  const {
    adoptPaidCashuQuote,
    autoswapCashu,
    cashuTokenLifecycle,
    checkAllCashuTokens,
    checkCashuTokenRow,
    meltCashuInvoice,
    probeLightningFee,
    receiveCashuToken,
    restoreCashuTokens,
    resumePendingCashuAutoswapClaims,
    resumePendingCashuTopups,
    sendCashuToken,
    startCashuTopup,
    walletBalances,
    walletTokens,
  } = useLinkshuComposition({
    cashuTokenRows: cashuTokensAllFiltered,
    currentNsec,
    update,
    upsert,
    writeOwnerId: cashuOwnerId,
  });

  // Legacy migration; removal gate in docs/architecture.md
  React.useEffect(() => {
    seedLinkshuSeenMintsFromTokenRows(cashuTokensAll);
  }, [cashuTokensAll]);

  // Legacy migration; removal gate in docs/architecture.md
  React.useEffect(() => {
    if (receiveCashuToken === null) return;
    void drainLegacyAcceptedCashuToken(receiveCashuToken);
  }, [receiveCashuToken]);

  const {
    cashuTokensHydratedRef,
    isCashuTokenKnownAny,
    isCashuTokenStored,
    rememberCashuTokenKnown,
  } = useCashuDomain({
    appOwnerId: cashuOwnerId,
    cashuTokensAll,
  });

  const {
    getMintIconUrl,
    getMintRuntime,
    isMintDeleted,
    mintInfoByUrl,
    mintInfoDeduped,
    refreshMintInfo,
    setMintIconUrlByMint,
    setMintInfoAll,
    touchMintInfo,
  } = useMintDomain({
    appOwnerId,
    appOwnerIdRef,
    cashuTokensAll: cashuTokensAllFiltered,
    defaultMintUrl,
    rememberSeenMint,
  });

  React.useEffect(() => {
    if (cashuTokenLifecycle === null) return;
    const pendingTokens = cashuTokensAllFiltered.filter((row) => {
      const state = row.state ?? "";
      if (state !== "pending") return false;
      const isDeleted = Boolean(row.isDeleted);
      return !isDeleted;
    });

    for (const row of pendingTokens) {
      const tokenText = (row.token ?? row.rawToken ?? "").trim();
      if (!tokenText) continue;
      const hasMessage = nostrMessagesLocal.some((m) => {
        const isOut = m.direction === "out";
        const matches = m.content.trim() === tokenText;
        const status = m.status ?? "sent";
        return isOut && matches && status !== "pending";
      });
      if (!hasMessage) continue;
      // Deleting through linkshu keeps the token store's write overlay in
      // sync; a raw Evolu delete would leave the overlay serving the row.
      void cashuTokenLifecycle.forget(row.id);
    }
  }, [cashuTokenLifecycle, cashuTokensAllFiltered, nostrMessagesLocal]);

  const cashuTotalBalance: number = walletBalances.total;
  const cashuBalance: number = walletBalances.spendable;

  // linkshu's per-mint balances re-keyed into the app's canonical mint-url
  // vocabulary, which the mint-selection and melt-planning logic compares by.
  const cashuAcceptedMintBalances = useMemo(() => {
    const balances = new Map<string, number>();
    for (const { amount, mint } of walletBalances.perMint) {
      const key = normalizeMintUrl(mint);
      if (!key) continue;
      balances.set(key, (balances.get(key) ?? 0) + amount);
    }
    return balances;
  }, [walletBalances]);

  const paymentMintMeltPlan = React.useMemo(() => {
    return getPaymentMintMeltPlan({
      mainMint: normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL),
      balances: Array.from(cashuAcceptedMintBalances, ([mint, sum]) => ({
        mint,
        sum,
      })),
    });
  }, [cashuAcceptedMintBalances, defaultMintUrl]);

  const cashuBalanceAfterMelt = Math.max(
    cashuBalance,
    paymentMintMeltPlan?.maxBalanceAfterMelt ?? 0,
  );

  const requestPaymentMintMelt = React.useCallback(
    (amountSat: number): boolean => {
      if (
        !canOfferPaymentMintMelt({
          amountSat,
          currentBalance: cashuBalance,
          plan: paymentMintMeltPlan,
        }) ||
        !paymentMintMeltPlan
      ) {
        return false;
      }

      setPendingPaymentMintMeltConfirmation({
        fromMint: paymentMintMeltPlan.fromMint,
        toMint: paymentMintMeltPlan.toMint,
      });
      return true;
    },
    [cashuBalance, paymentMintMeltPlan],
  );

  const cashuHasMultipleAcceptedMints = cashuAcceptedMintBalances.size > 1;

  const cashuOwnTokens = React.useMemo(
    () =>
      walletTokens.filter(
        (token) =>
          !isCashuTokenEmittedState(token.state) &&
          !isCashuTokenReservedState(token.state),
      ),
    [walletTokens],
  );

  const cashuIssuedTokens = React.useMemo(
    () =>
      walletTokens.filter(
        (token) =>
          isCashuTokenEmittedState(token.state) ||
          isCashuTokenReservedState(token.state),
      ),
    [walletTokens],
  );

  const cashuOwnSpentTokens = React.useMemo(
    () =>
      walletTokens.filter(
        (token) =>
          !isCashuTokenEmittedState(token.state) &&
          !isCashuTokenReservedState(token.state) &&
          isCashuTokenDefinitivelySpent({
            state: token.state,
            error: token.error,
          }),
      ),
    [walletTokens],
  );

  // Removal happens through linkshu `Tokens.deleteSpent`: rows go only when
  // the mint itself confirms all their proofs spent — including legacy
  // plain-text error rows — never on the locally recorded error alone.
  const [deleteSpentCashuTokensIsBusy, setDeleteSpentCashuTokensIsBusy] =
    useState(false);
  const deleteSpentCashuTokens = React.useCallback(async () => {
    if (deleteSpentCashuTokensIsBusy) return;
    if (cashuTokenLifecycle === null) return;

    setDeleteSpentCashuTokensIsBusy(true);
    try {
      const deleted = await cashuTokenLifecycle.deleteSpent();
      if (deleted.length > 0) {
        setStatus(
          t("cashuDeleteSpentDone").replace("{count}", String(deleted.length)),
        );
      }
    } finally {
      setDeleteSpentCashuTokensIsBusy(false);
    }
  }, [cashuTokenLifecycle, deleteSpentCashuTokensIsBusy, setStatus, t]);

  const canPayWithCashu = cashuBalance > 0;

  const [postPaySaveContact, setPostPaySaveContact] = React.useState<null | {
    lnAddress: string;
    amountSat: number;
  }>(null);

  const {
    setTopupAmount,
    startBackgroundTopup,
    topupAmount,
    topupInvoice,
    topupInvoiceCashuRequest,
    topupInvoiceError,
    topupInvoiceIsBusy,
    topupInvoiceQr,
    topupInvoiceQrPayload,
    topupMintUrl,
  } = useTopupFlow({
    cashuTotalBalance,
    defaultMintUrl,
    formatDisplayedAmountParts,
    logPaymentEvent,
    resumePendingCashuTopups,
    routeKind: route.kind,
    showPaidOverlay,
    startCashuTopup,
    t,
    topupPaidNavTimerRef,
    topupRecipientNprofile,
  });

  const defaultMintDisplay = useMemo(() => {
    if (!defaultMintUrl) return null;
    try {
      const u = new URL(defaultMintUrl);
      return u.host;
    } catch {
      return defaultMintUrl;
    }
  }, [defaultMintUrl]);

  const {
    applyDefaultMintSelection: applyDefaultMintSelectionInner,
    makeNip98AuthHeader,
  } = useNpubCashMintSelection({
    currentNpub,
    currentNsec,
    defaultMintUrl,
    defaultMintUrlDraft,
    hasMintOverrideRef,
    makeLocalStorageKey,
    npubCashMintSyncRef,
    pushToast,
    setDefaultMintUrl,
    setDefaultMintUrlDraft,
    setStatus,
    t,
  });

  const applyDefaultMintSelection = React.useCallback(
    async (mintUrl: string): Promise<void> => {
      await applyDefaultMintSelectionInner(mintUrl);
      // Mirror the user's explicit choice into Evolu's ownerMeta so other
      // tabs/devices converge. Done here (not in a defaultMintUrl-watch
      // effect) to avoid stale-closure ping-pong with the remote.
      upsertDefaultMintToOwnerMetaRef.current(mintUrl);
    },
    [applyDefaultMintSelectionInner],
  );

  React.useEffect(() => {
    if (isNpubCashDisabled() || !currentNpub || !currentNsec) {
      setOwnedProfileLightningAddresses([]);
      setOwnedProfileLightningAddressesLoading(false);
      return;
    }

    setOwnedProfileLightningAddresses([]);
    setOwnedProfileLightningAddressesLoading(true);

    const controller = new AbortController();
    let cancelled = false;

    const loadOwnedLightningAddresses = async () => {
      try {
        const url = `${NPUB_CASH_SERVER_BASE_URL}/api/v1/info`;
        const auth = await makeNip98AuthHeader(url, "GET");
        const response = await fetch(url, {
          method: "GET",
          headers: { Authorization: auth },
          signal: controller.signal,
        });
        if (!response.ok) {
          if (!cancelled) {
            setOwnedProfileLightningAddresses([]);
            setOwnedProfileLightningAddressesLoading(false);
          }
          return;
        }

        const json = await response.json();
        if (cancelled) return;

        const info = parseNpubCashProfileInfo(json);
        setOwnedProfileLightningAddresses(info.ownedLightningAddresses);
        setOwnedProfileLightningAddressesLoading(false);
      } catch {
        if (cancelled) return;
        setOwnedProfileLightningAddresses([]);
        setOwnedProfileLightningAddressesLoading(false);
      }
    };

    void loadOwnedLightningAddresses();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    currentNpub,
    currentNsec,
    makeNip98AuthHeader,
    setOwnedProfileLightningAddresses,
    setOwnedProfileLightningAddressesLoading,
  ]);

  const { claimNpubCashOnce, claimNpubCashOnceLatestRef } = useNpubCashClaim({
    adoptPaidCashuQuote,
    cashuIsBusy,
    currentNpub: nostrBootstrapReady ? currentNpub : null,
    currentNsec: nostrBootstrapReady ? currentNsec : null,
    enqueueCashuOp,
    formatDisplayedAmountParts,
    isMintDeleted,
    logPaymentEvent,
    makeLocalStorageKey,
    makeNip98AuthHeader,
    maybeShowPwaNotification,
    mintInfoByUrl,
    npubCashClaimInFlightRef,
    receiveCashuToken,
    refreshMintInfo,
    resolveOwnerIdForWrite,
    rememberCashuTokenKnown,
    routeKind: route.kind,
    setCashuIsBusy,
    setStatus,
    showPaidOverlay,
    t,
    touchMintInfo,
  });

  useProfileNpubCashEffects({
    claimNpubCashOnce,
    claimNpubCashOnceLatestRef,
    currentNpub,
    currentNsec,
    hasMintOverrideRef,
    makeNip98AuthHeader,
    networkEnabled: nostrBootstrapReady,
    npubCashInfoInFlightRef,
    npubCashInfoLoadedAtMsRef,
    npubCashInfoLoadedForNpubRef,
    routeKind: route.kind,
    setDefaultMintUrl,
    setDefaultMintUrlDraft,
    setIsProfileEditing,
    setMyProfileQr,
  });

  const [contactPayMethod, setContactPayMethod] = useState<
    null | "cashu" | "lightning"
  >(null);
  useContactPayMethod({
    payWithCashuEnabled,
    routeKind: route.kind,
    selectedContactLnAddress: selectedContact?.lnAddress ?? "",
    selectedContactNpub: selectedContact?.npub ?? "",
    setContactPayMethod,
  });

  const payContactWithCashuMessage =
    usePayContactWithCashuMessage<ContactRowLike>({
      appendLocalNostrMessage,
      cashuBalance,
      cashuTokenLifecycle,
      currentNpub,
      currentNsec,
      defaultMintUrl,
      enqueuePendingPayment,
      formatDisplayedAmountParts,
      logPayStep,
      logPaymentEvent,
      nostrMessagesLocal,
      payWithCashuEnabled,
      pushToast,
      sendCashuToken,
      setContactsOnboardingHasPaid,
      setStatus,
      showPaidOverlay,
      t,
      updateLocalNostrMessage,
      walletMintBalances: walletBalances.perMint,
    });

  const settleBankPaymentOffer = React.useCallback(
    async (message: LocalNostrMessage) => {
      if (cashuIsBusy) return;

      const offerInfo = getLinkyBankPaymentOfferInfo(message.content);
      if (!offerInfo || offerInfo.status !== "bank_paid") {
        setStatus(t("spdPaymentOfferFailed"));
        return;
      }
      if (isBankPaymentOfferCanceled(offerInfo.offerId)) {
        setStatus(t("bankPaymentOfferStatusCanceled"));
        return;
      }
      if (!offerInfo.amountSat) {
        setStatus(t("payInvalidAmount"));
        return;
      }

      const contactId = message.contactId.trim();
      const contact =
        contacts.find((candidate) => candidate.id.trim() === contactId) ?? null;
      if (!contact) {
        setStatus(t("contactNotFound"));
        return;
      }

      setCashuIsBusy(true);
      try {
        const result = await payContactWithCashuMessage({
          contact,
          amountSat: offerInfo.amountSat,
          logCompletedOnly: true,
          paymentNoticeContext: "bank_payment_offer",
          paymentNoticeOfferId: offerInfo.offerId,
        });
        if (!result.ok) return;

        await respondToBankPaymentOfferWithGroupState(message, "settled");
      } finally {
        setCashuIsBusy(false);
      }
    },
    [
      cashuIsBusy,
      contacts,
      isBankPaymentOfferCanceled,
      payContactWithCashuMessage,
      respondToBankPaymentOfferWithGroupState,
      setCashuIsBusy,
      setStatus,
      t,
    ],
  );

  usePaymentsDomain({
    cashuIsBusy,
    contacts,
    currentNpub,
    currentNsec,
    payContactWithCashuMessage,
    pendingPayments,
    pushToast,
    removePendingPayment,
    setCashuIsBusy,
    t,
  });

  const paySelectedContact = React.useCallback(async () => {
    if (cashuIsBusy) return;
    if (route.kind !== "contactPay") return;
    if (!selectedContact) return;

    const amountSat = Number.parseInt(payAmount.trim(), 10);
    if (!Number.isFinite(amountSat) || amountSat <= 0) {
      setStatus(t("payInvalidAmount"));
      return;
    }

    if (amountSat > cashuBalance) {
      if (!requestPaymentMintMelt(amountSat)) {
        setStatus(t("payInsufficient"));
      }
      return;
    }

    const normalizedMethod =
      contactPayMethod === "lightning" || contactPayMethod === "cashu"
        ? contactPayMethod
        : "cashu";

    if (normalizedMethod === "lightning") {
      const lnAddress = (selectedContact.lnAddress ?? "").trim();
      if (!lnAddress) {
        setStatus(t("payMissingLn"));
        return;
      }
      setLnAddressPayAmount(String(amountSat));
      navigateTo({ route: "lnAddressPay", lnAddress });
      return;
    }

    setCashuIsBusy(true);
    try {
      await payContactWithCashuMessage({
        contact: selectedContact,
        amountSat,
      });
    } finally {
      setCashuIsBusy(false);
    }
  }, [
    cashuIsBusy,
    cashuBalance,
    contactPayMethod,
    payAmount,
    payContactWithCashuMessage,
    requestPaymentMintMelt,
    route.kind,
    selectedContact,
    setCashuIsBusy,
    setLnAddressPayAmount,
    setStatus,
    t,
  ]);

  const findContactForCashuPaymentRequest = React.useCallback(
    (requestInfo: CashuPaymentRequestMessageInfo) => {
      const requestPubkeyHex = normalizePubkeyHex(
        requestInfo.transportPubkeyHex,
      );
      if (!requestPubkeyHex) return null;

      for (const contact of contacts) {
        const normalizedNpub = normalizeNpubIdentifier(contact.npub ?? "");
        if (!normalizedNpub) continue;

        if (decodeNpub(normalizedNpub) === requestPubkeyHex) return contact;
      }

      return null;
    },
    [contacts],
  );

  const ensureContactForCashuPaymentRequest = React.useCallback(
    (requestInfo: CashuPaymentRequestMessageInfo): ContactRowLike | null => {
      const existing = findContactForCashuPaymentRequest(requestInfo);
      if (existing?.id) return existing;

      const requestPubkeyHex = normalizePubkeyHex(
        requestInfo.transportPubkeyHex,
      );
      if (!requestPubkeyHex) return null;

      const pubkey = parsePubkey(requestPubkeyHex);
      if (!pubkey) return null;
      const npub = encodeNpub(pubkey);

      const saved = saveNpubContact(npub);
      if (!saved) return null;
      if (saved.created) openScannedContactPendingNpubRef.current = saved.npub;
      return saved.contact;
    },
    [
      findContactForCashuPaymentRequest,
      openScannedContactPendingNpubRef,
      saveNpubContact,
    ],
  );

  const findPreviousCashuPaymentRequestMessage = React.useCallback(
    (
      requestInfo: CashuPaymentRequestMessageInfo,
      contactId: string,
    ): LocalNostrMessage | null => {
      const normalizedContactId = contactId.trim();
      if (!normalizedContactId) return null;

      const requestId = (requestInfo.requestId ?? "").trim();
      const encodedRequest = requestInfo.encodedRequest.trim();
      if (!requestId && !encodedRequest) return null;

      const candidates = [
        ...chatMessages,
        ...nostrMessagesRecent,
        ...nostrMessagesLocal,
      ];

      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const message = candidates[index];
        if (message.contactId.trim() !== normalizedContactId) {
          continue;
        }
        if (message.direction.trim() !== "in") continue;

        const rumorId = (message.rumorId ?? "").trim();
        if (!rumorId) continue;

        const previousInfo = parseCashuPaymentRequestMessage(message.content);
        if (!previousInfo) continue;

        const previousRequestId = (previousInfo.requestId ?? "").trim();
        if (requestId && previousRequestId === requestId) return message;

        if (
          !requestId &&
          previousInfo.encodedRequest.trim() === encodedRequest
        ) {
          return message;
        }
      }

      return null;
    },
    [chatMessages, nostrMessagesLocal, nostrMessagesRecent],
  );

  const payCashuPaymentRequestViaPost = React.useCallback(
    async (requestInfo: CashuPaymentRequestMessageInfo): Promise<boolean> => {
      const postUrlRaw = (requestInfo.transportPostUrl ?? "").trim();
      if (!postUrlRaw) return false;

      let postUrl: URL;
      try {
        postUrl = new URL(postUrlRaw);
      } catch {
        setStatus(t("paymentRequestUnknownContact"));
        return false;
      }

      if (postUrl.protocol !== "https:" && postUrl.protocol !== "http:") {
        setStatus(t("paymentRequestUnknownContact"));
        return false;
      }

      if (cashuBalance < requestInfo.amount) {
        setStatus(t("payInsufficient"));
        return true;
      }

      if (sendCashuToken === null || cashuTokenLifecycle === null) {
        setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
        return true;
      }

      setCashuIsBusy(true);

      let sentMint: string | null = null;
      const logFailure = (
        error: string,
        mint: string | null,
        phase: "publish" | "swap",
      ): void => {
        logPaymentEvent({
          direction: "out",
          status: "error",
          amount: requestInfo.amount,
          fee: null,
          mint,
          unit: "sat",
          error,
          contactId: null,
          method: "cashu_chat",
          phase,
        });
      };

      try {
        const requestedMints = new Set<string>();
        for (const mintUrl of requestInfo.mintUrls) {
          const normalizedMint = normalizeMintUrl(mintUrl);
          if (normalizedMint) requestedMints.add(normalizedMint);
        }

        const eligibleBalances =
          requestedMints.size > 0
            ? walletBalances.perMint.filter((entry) =>
                requestedMints.has(normalizeMintUrl(entry.mint)),
              )
            : walletBalances.perMint;
        const preferredMint =
          requestInfo.mintUrls
            .map((mintUrl) => normalizeMintUrl(mintUrl))
            .find((mintUrl) => Boolean(mintUrl)) ??
          normalizeMintUrl(defaultMintUrl ?? "");
        const mint = selectSendMintForAmount(
          eligibleBalances,
          preferredMint,
          requestInfo.amount,
        );
        if (mint === null) {
          setStatus(t("payInsufficient"));
          return true;
        }

        const sendOutcome = await sendCashuToken({
          amountSat: requestInfo.amount,
          mint,
          produceAs: "pending",
        });
        if (Either.isLeft(sendOutcome)) {
          const sendError = sendOutcome.left;
          const errorMessage =
            describeTaggedCashuError(sendError) ?? sendError._tag;
          logFailure(errorMessage, mint, "swap");
          setStatus(
            sendError._tag === "InsufficientFunds"
              ? t("payInsufficient")
              : `${t("payFailed")}: ${errorMessage}`,
          );
          return true;
        }
        const receipt = sendOutcome.right;
        sentMint = receipt.mint;

        try {
          const decoded = decodeTokenText(receipt.tokenText);
          if (decoded === null) throw new Error("empty payment proofs");

          const body: Record<string, unknown> = {
            mint: receipt.mint,
            unit: receipt.unit,
            proofs: decoded.proofs,
          };
          if (requestInfo.requestId) body.id = requestInfo.requestId;
          if (requestInfo.description) body.memo = requestInfo.description;

          const response = await fetch(postUrl.toString(), {
            method: "POST",
            cache: "no-store",
            credentials: "omit",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            mode: "cors",
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            throw new Error(`Payment request POST ${response.status}`);
          }
        } catch (error) {
          // The POST recipient may hold the proofs now; re-receiving kills
          // that encoding at the mint before the funds return to balance.
          const restored = await cashuTokenLifecycle.returnToWallet(
            receipt.rowId,
          );
          if (Either.isLeft(restored)) {
            console.warn("[linky][payment-request] return-to-wallet failed", {
              error: restored.left._tag,
            });
          }
          throw error;
        }

        await cashuTokenLifecycle.forget(receipt.rowId);
        reportCashuSendRowForgotten({
          mint: receipt.mint,
          reason: "payment-request-posted",
          rowId: receipt.rowId,
        });

        logPaymentEvent({
          direction: "out",
          status: "ok",
          amount: receipt.amount,
          details: {
            issuedToken: receipt.tokenText,
            ...(requestInfo.requestId
              ? { requestId: requestInfo.requestId }
              : {}),
            postUrl: postUrl.toString(),
          },
          fee: null,
          mint: receipt.mint,
          unit: receipt.unit,
          error: null,
          contactId: null,
          method: "cashu_chat",
          phase: "complete",
        });

        const displayAmount = formatDisplayedAmountParts(receipt.amount);
        showPaidOverlay(
          t("paidSentTo")
            .replace(
              "{amount}",
              `${displayAmount.approxPrefix}${displayAmount.amountText}`,
            )
            .replace("{unit}", displayAmount.unitLabel)
            .replace(
              "{name}",
              requestInfo.description || postUrl.hostname || t("appTitle"),
            ),
        );
        safeLocalStorageSet(CONTACTS_ONBOARDING_HAS_PAID_STORAGE_KEY, "1");
        setContactsOnboardingHasPaid(true);
        return true;
      } catch (error) {
        const errorMessage = getUnknownErrorMessage(error, "unknown");
        logFailure(errorMessage, sentMint, "publish");
        setStatus(`${t("payFailed")}: ${errorMessage}`);
        return true;
      } finally {
        setCashuIsBusy(false);
      }
    },
    [
      cashuBalance,
      cashuTokenLifecycle,
      defaultMintUrl,
      formatDisplayedAmountParts,
      logPaymentEvent,
      sendCashuToken,
      setCashuIsBusy,
      setContactsOnboardingHasPaid,
      setStatus,
      showPaidOverlay,
      t,
      walletBalances.perMint,
    ],
  );

  const payCashuPaymentRequest = React.useCallback(
    async (requestInfo: CashuPaymentRequestMessageInfo) => {
      if (cashuIsBusy) return;
      if (requestInfo.amount > cashuBalance) {
        const requestedMints = requestInfo.mintUrls.flatMap((mintUrl) => {
          const normalizedMint = normalizeMintUrl(mintUrl);
          return normalizedMint ? [normalizedMint] : [];
        });
        const targetMainMint = paymentMintMeltPlan?.toMint ?? "";
        const mainMintIsAccepted =
          requestedMints.length === 0 ||
          (Boolean(targetMainMint) && requestedMints.includes(targetMainMint));
        if (
          !mainMintIsAccepted ||
          !requestPaymentMintMelt(requestInfo.amount)
        ) {
          setStatus(t("payInsufficient"));
        }
        return;
      }

      const contact = ensureContactForCashuPaymentRequest(requestInfo);
      if (!contact?.id) {
        if (await payCashuPaymentRequestViaPost(requestInfo)) return;
        setStatus(t("paymentRequestUnknownContact"));
        return;
      }

      setCashuIsBusy(true);
      try {
        const previousRequestMessage = findPreviousCashuPaymentRequestMessage(
          requestInfo,
          contact.id,
        );
        const previousRequestRumorId = (
          previousRequestMessage?.rumorId ?? ""
        ).trim();

        await payContactWithCashuMessage({
          contact,
          amountSat: requestInfo.amount,
          paymentRequestId: requestInfo.requestId,
          ...(previousRequestRumorId
            ? {
                replyContext: {
                  replyToId: previousRequestRumorId,
                  rootMessageId:
                    (previousRequestMessage?.rootMessageId ?? "").trim() ||
                    previousRequestRumorId,
                  replyToContent:
                    (previousRequestMessage?.content ?? "").trim() || null,
                },
              }
            : {}),
        });
      } finally {
        setCashuIsBusy(false);
      }
    },
    [
      cashuIsBusy,
      cashuBalance,
      ensureContactForCashuPaymentRequest,
      findPreviousCashuPaymentRequestMessage,
      payCashuPaymentRequestViaPost,
      payContactWithCashuMessage,
      paymentMintMeltPlan?.toMint,
      requestPaymentMintMelt,
      setCashuIsBusy,
      setStatus,
      t,
    ],
  );

  const {
    payLightningAddressWithCashu: payLightningAddressWithCashuBase,
    payLightningInvoiceWithCashu: payLightningInvoiceWithCashuBase,
  } = useLightningPaymentsDomain({
    canPayWithCashu,
    cashuBalance,
    cashuIsBusy,
    contacts,
    defaultMintUrl,
    formatDisplayedAmountParts,
    logPaymentEvent,
    meltCashuInvoice,
    setCashuIsBusy,
    setContactsOnboardingHasPaid,
    setPostPaySaveContact,
    setStatus,
    showPaidOverlay,
    t,
    walletMintBalances: walletBalances.perMint,
  });

  const payLightningAddressWithCashu = React.useCallback(
    async (lnAddress: string, amountSat: number): Promise<void> => {
      if (amountSat > cashuBalance) {
        if (!requestPaymentMintMelt(amountSat)) {
          setStatus(t("payInsufficient"));
        }
        return;
      }
      const paid = await payLightningAddressWithCashuBase(lnAddress, amountSat);
      if (paid) navigateTo({ route: "wallet" });
    },
    [
      cashuBalance,
      payLightningAddressWithCashuBase,
      requestPaymentMintMelt,
      setStatus,
      t,
    ],
  );

  const payLightningInvoiceWithCashu = React.useCallback(
    async (invoice: string): Promise<boolean> => {
      const amountSat = getLightningInvoicePreview(invoice)?.amountSat ?? null;
      if (amountSat !== null && amountSat > cashuBalance) {
        if (!requestPaymentMintMelt(amountSat)) {
          setStatus(t("payInsufficient"));
        }
        return false;
      }
      const paid = await payLightningInvoiceWithCashuBase(invoice);
      if (paid && route.kind === "manualPay") {
        navigateTo({ route: "wallet" });
      }
      return paid;
    },
    [
      cashuBalance,
      payLightningInvoiceWithCashuBase,
      requestPaymentMintMelt,
      route.kind,
      setStatus,
      t,
    ],
  );

  const closeLightningInvoiceConfirmation = React.useCallback(() => {
    setPendingLightningInvoiceConfirmation(null);
  }, []);

  const confirmLightningInvoicePayment = React.useCallback(async () => {
    const pending = pendingLightningInvoiceConfirmation;
    if (!pending) return;

    const ok = await payLightningInvoiceWithCashu(pending.invoice);
    if (ok) setPendingLightningInvoiceConfirmation(null);
  }, [payLightningInvoiceWithCashu, pendingLightningInvoiceConfirmation]);

  const closeLnurlWithdrawConfirmation = React.useCallback(() => {
    if (lnurlWithdrawIsBusy) return;
    setPendingLnurlWithdrawConfirmation(null);
  }, [lnurlWithdrawIsBusy]);

  const confirmLnurlWithdraw = React.useCallback(async () => {
    const pending = pendingLnurlWithdrawConfirmation;
    if (!pending || lnurlWithdrawIsBusy) return;

    const mintUrl = normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL);
    if (!mintUrl) {
      setStatus(t("topupInvoiceFailed"));
      return;
    }

    setLnurlWithdrawIsBusy(true);
    try {
      setStatus(t("lnurlWithdrawPreparing"));
      const started = await startBackgroundTopup({
        amountSat: pending.amountSat,
        mint: mintUrl,
      });
      if (Either.isLeft(started)) {
        setStatus(`${t("errorPrefix")}: ${started.left}`);
        return;
      }
      await redeemLnurlWithdraw({
        callback: pending.callback,
        invoice: started.right.invoice,
        k1: pending.k1,
      });
      setPendingLnurlWithdrawConfirmation(null);
      setStatus(t("lnurlWithdrawPending"));
    } catch (error) {
      const message = getUnknownErrorMessage(error, t("lnurlWithdrawFailed"));
      setStatus(`${t("errorPrefix")}: ${message}`);
    } finally {
      setLnurlWithdrawIsBusy(false);
    }
  }, [
    defaultMintUrl,
    lnurlWithdrawIsBusy,
    pendingLnurlWithdrawConfirmation,
    setStatus,
    startBackgroundTopup,
    t,
  ]);

  const [walletWarningDismissed, setWalletWarningDismissed] = React.useState(
    () => safeLocalStorageGet(WALLET_WARNING_DISMISSED_STORAGE_KEY) === "1",
  );

  const walletWarningApplies =
    cashuBalance > WALLET_WARNING_BALANCE_THRESHOLD_SAT;

  const dismissWalletWarning = React.useCallback(() => {
    safeLocalStorageSet(WALLET_WARNING_DISMISSED_STORAGE_KEY, "1");
    setWalletWarningDismissed(true);
  }, []);

  const saveCashuFromText = useSaveCashuFromText({
    enqueueCashuOp,
    formatDisplayedAmountParts,
    isCashuTokenStored,
    isMintDeleted,
    logPaymentEvent,
    mintInfoByUrl,
    receiveCashuToken,
    refreshMintInfo,
    rememberCashuTokenKnown,
    setCashuDraft,
    setCashuIsBusy,
    setStatus,
    showPaidOverlay,
    t,
    touchMintInfo,
  });

  const {
    checkAllCashuTokensAndDeleteInvalid,
    checkAndRefreshCashuToken,
    requestDeleteCashuToken,
  } = useCashuTokenChecks({
    cashuBulkCheckIsBusy,
    cashuIsBusy,
    checkAllCashuTokens,
    checkCashuTokenRow,
    forgetCashuToken: cashuTokenLifecycle?.forget ?? null,
    pendingCashuDeleteId,
    pushToast,
    setCashuBulkCheckIsBusy,
    setCashuIsBusy,
    setPendingCashuDeleteId,
    setStatus,
    t,
  });

  // Issued-token claim detection over linkshu Validation.checkIssued: one
  // passive NUT-07 batch per mint of `issued` rows, claimed rows removed by
  // the package. A shared in-flight promise keeps the callers (list-page
  // mount, manual button, token-page 10s poll, 60s background tick) from
  // stacking redundant mint round-trips.
  const checkIssuedInFlightRef = React.useRef<Promise<{
    claimed: ReadonlyArray<{ amount: number; id: string }>;
  }> | null>(null);
  const checkIssuedCashuTokensAndDeleteClaimed = React.useCallback((): Promise<{
    claimed: ReadonlyArray<{ amount: number; id: string }>;
  }> => {
    if (cashuTokenLifecycle === null) {
      return Promise.resolve({ claimed: [] });
    }
    const inFlight = checkIssuedInFlightRef.current;
    if (inFlight) return inFlight;

    const run = cashuTokenLifecycle
      .checkIssuedClaims()
      .then((report) => ({
        claimed: report.claimed.map((entry) => ({
          amount: entry.amount,
          id: entry.rowId,
        })),
      }))
      .finally(() => {
        checkIssuedInFlightRef.current = null;
      });
    checkIssuedInFlightRef.current = run;
    return run;
  }, [cashuTokenLifecycle]);

  const checkSingleIssuedCashuTokenIsClaimed = React.useCallback(
    async (id: CashuTokenId): Promise<boolean> => {
      const outcome = await checkIssuedCashuTokensAndDeleteClaimed();
      return outcome.claimed.some((entry) => entry.id === id);
    },
    [checkIssuedCashuTokensAndDeleteClaimed],
  );

  // Background check for issued-token claims (issue #86). Runs once on
  // mount and every 60s thereafter while we have any issued tokens.
  // Detection removes the row, so the issued list cleans up even when the
  // user isn't sitting on #wallet/tokens; the ref keeps the 60s interval
  // from being torn down whenever the callback identity churns.
  const hasAnyIssuedTokensForBackgroundCheck = cashuIssuedTokens.length > 0;
  const checkIssuedCashuTokensRef = useLatest(
    checkIssuedCashuTokensAndDeleteClaimed,
  );
  const formatDisplayedAmountTextRef = useLatest(formatDisplayedAmountText);
  const pushToastRef = useLatest(pushToast);
  const claimToastTRef = useLatest(t);
  React.useEffect(() => {
    if (!hasAnyIssuedTokensForBackgroundCheck) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const outcome = await checkIssuedCashuTokensRef.current();
        if (cancelled) return;
        if (outcome.claimed.length === 0) return;
        // Background detection — surface a toast so the user knows the
        // issued token was redeemed even when they aren't on the QR
        // screen (the CashuTokenPage poll handles the in-page UX with a
        // checkmark overlay).
        const formatter = formatDisplayedAmountTextRef.current;
        const tt = claimToastTRef.current;
        for (const entry of outcome.claimed) {
          const message =
            entry.amount > 0
              ? tt("cashuTokenClaimedWithAmount").replace(
                  "{amount}",
                  formatter(entry.amount),
                )
              : tt("cashuTokenClaimed");
          pushToastRef.current(message);
        }
      } catch {
        // ignore — the helper already swallows mint-side errors.
      }
    };
    void tick();
    const intervalId = window.setInterval(() => {
      void tick();
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    checkIssuedCashuTokensRef,
    claimToastTRef,
    formatDisplayedAmountTextRef,
    pushToastRef,
    hasAnyIssuedTokensForBackgroundCheck,
  ]);

  const returnCashuTokenToWallet = React.useCallback(
    async (id: CashuTokenId) => {
      if (cashuTokenLifecycle === null) {
        setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
        return;
      }
      const outcome = await cashuTokenLifecycle.returnToWallet(id);
      if (Either.isLeft(outcome)) {
        const message =
          describeTaggedCashuError(outcome.left) ?? outcome.left._tag;
        setStatus(`${t("errorPrefix")}: ${message}`);
        return;
      }

      setStatus(t("cashuReturnedToWallet"));
    },
    [cashuTokenLifecycle, setStatus, t],
  );

  const pendingCashuContactSend = React.useMemo(() => {
    if (!pendingCashuTokenContactPickId) return null;

    const row = cashuTokensAllFiltered.find(
      (candidate) =>
        candidate.id === pendingCashuTokenContactPickId &&
        !candidate.isDeleted &&
        isCashuTokenIssuedState(candidate.state),
    );
    if (!row) return null;

    const meta = extractCashuTokenMeta(row);
    const amountSat = meta.amount ?? row.amount ?? 0;
    if (!Number.isFinite(amountSat) || amountSat <= 0) return null;

    return {
      amountSat: Math.floor(amountSat),
      tokenId: pendingCashuTokenContactPickId,
    };
  }, [cashuTokensAllFiltered, pendingCashuTokenContactPickId]);

  const cancelPendingCashuContactSend = React.useCallback(async () => {
    const tokenId = pendingCashuContactSend?.tokenId ?? null;
    setPendingCashuTokenContactPickId(null);
    if (!tokenId) return;

    await returnCashuTokenToWallet(tokenId);
  }, [pendingCashuContactSend, returnCashuTokenToWallet]);

  const runCashuTokenTransition = React.useCallback(
    async (
      id: CashuTokenId,
      transition: "markExternalized" | "markIssued" | "reserve",
    ): Promise<boolean> => {
      if (cashuTokenLifecycle === null) {
        setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
        return false;
      }
      const outcome = await cashuTokenLifecycle[transition](id);
      if (Either.isLeft(outcome)) {
        const message =
          describeTaggedCashuError(outcome.left) ?? outcome.left._tag;
        setStatus(`${t("errorPrefix")}: ${message}`);
        return false;
      }
      return true;
    },
    [cashuTokenLifecycle, setStatus, t],
  );

  const reserveCashuToken = React.useCallback(
    async (id: CashuTokenId) => {
      if (await runCashuTokenTransition(id, "reserve")) {
        setStatus(t("cashuReserved"));
      }
    },
    [runCashuTokenTransition, setStatus, t],
  );

  const markCashuTokenIssued = React.useCallback(
    (id: CashuTokenId): Promise<boolean> =>
      runCashuTokenTransition(id, "markIssued"),
    [runCashuTokenTransition],
  );

  const markCashuTokenExternalized = React.useCallback(
    (id: CashuTokenId): Promise<boolean> =>
      runCashuTokenTransition(id, "markExternalized"),
    [runCashuTokenTransition],
  );

  const deleteCashuToken = React.useCallback(
    async (id: CashuTokenId): Promise<boolean> => {
      if (cashuTokenLifecycle === null) {
        setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
        return false;
      }
      const matchingAliases = new Set<string>();

      for (const row of cashuTokensAll) {
        if (row.isDeleted || row.id !== id) continue;
        for (const alias of readCashuRowAliases(row)) {
          matchingAliases.add(alias);
        }
      }

      let aliasesExpanded = true;
      while (aliasesExpanded) {
        aliasesExpanded = false;

        for (const row of cashuTokensAll) {
          if (row.isDeleted) continue;
          const rowAliases = readCashuRowAliases(row);
          if (
            rowAliases.length === 0 ||
            !rowAliases.some((alias) => matchingAliases.has(alias))
          ) {
            continue;
          }

          for (const alias of rowAliases) {
            if (matchingAliases.has(alias)) continue;
            matchingAliases.add(alias);
            aliasesExpanded = true;
          }
        }
      }

      const rowsToDelete =
        matchingAliases.size > 0
          ? cashuTokensAll.filter((row) => {
              if (row.isDeleted) return false;
              return readCashuRowAliases(row).some((alias) =>
                matchingAliases.has(alias),
              );
            })
          : [];

      try {
        if (rowsToDelete.length > 0) {
          for (const row of rowsToDelete) {
            await cashuTokenLifecycle.forget(row.id);
          }
        } else {
          await cashuTokenLifecycle.forget(id);
        }
      } catch (error) {
        setStatus(`${t("errorPrefix")}: ${String(error)}`);
        return false;
      }

      return true;
    },
    [cashuTokenLifecycle, cashuTokensAll, setStatus, t],
  );

  const startSendCashuTokenToContact = React.useCallback(
    async (id: CashuTokenId) => {
      setPendingCashuTokenContactPickId(id);
      setStatus(t("cashuSelectContactToSend"));
      navigateTo({ route: "contacts" });
    },
    [setStatus, t],
  );

  const sendCashuTokenToContact = React.useCallback(
    async (contact: DisplayContact, tokenId: CashuTokenId) => {
      setPendingCashuTokenContactPickId(null);

      const row = cashuTokensAllFiltered.find(
        (candidate) => candidate.id === tokenId && !candidate.isDeleted,
      );
      const tokenMeta = row ? extractCashuTokenMeta(row) : null;
      const tokenText = (tokenMeta?.tokenText ?? "").trim();

      if (!row || !tokenText || !isCashuTokenIssuedState(row.state)) {
        setStatus(t("cashuInvalid"));
        return;
      }

      const contactId = (contact.id ?? "").trim();
      if (!contactId) {
        setStatus(t("contactNotFound"));
        return;
      }

      if (!currentNsec) {
        setStatus(t("profileMissingNpub"));
        return;
      }

      let contactPubHex = normalizePubkeyHex(contact.unknownPubkeyHex);
      const contactNpub = normalizeNpubIdentifier(contact.npub ?? "");

      if (!contactPubHex && contactNpub) {
        contactPubHex = decodeNpub(contactNpub);
      }

      if (!contactPubHex || !isPubkey(contactPubHex)) {
        setStatus(t("chatMissingContactNpub"));
        return;
      }

      const transactionNote =
        (contact.name ?? "").trim() || (contact.lnAddress ?? "").trim() || null;
      const logIssuedTokenSendTransaction = (phase: "complete" | "publish") => {
        logPaymentEvent({
          amount: tokenMeta?.amount ?? null,
          contactId,
          details: {
            usedInputTokens: [tokenText],
          },
          direction: "out",
          error: null,
          fee: null,
          method: "cashu_chat",
          mint: tokenMeta?.mint ?? null,
          note: transactionNote,
          phase,
          status: "ok",
          unit: tokenMeta?.unit ?? null,
        });
      };

      try {
        const identity = identityFromNsec(currentNsec);
        if (!identity) throw new Error("invalid nsec");
        const myPubHex = identity.pubkey;
        const token = decodeCashuTokenText(tokenText);
        if (Either.isLeft(token)) {
          throw new Error("invalid cashu token");
        }
        const clientId = ClientId.make(makeLocalId());
        const pendingId = appendLocalNostrMessage({
          contactId,
          direction: "out",
          content: tokenText,
          wrapId: `pending:${clientId}`,
          rumorId: null,
          pubkey: myPubHex,
          createdAtSec: Math.ceil(Date.now() / 1e3),
          status: "pending",
          clientId,
        });
        if (!pendingId) throw new Error("failed to persist message");

        const deleted = await deleteCashuToken(tokenId);
        if (!deleted) {
          return;
        }

        navigateTo({ route: "chat", id: contactId });

        const draft = new TokenMessageDraft({
          to: contactPubHex,
          token: token.right,
          clientId,
        });
        const exit = await enqueueOutbox({
          op: { _tag: "chat.token", draft },
          ref: OutboxRef.make(`message:${pendingId}`),
        });

        if (Exit.isFailure(exit)) {
          setStatus(`${t("errorPrefix")}: ${Cause.pretty(exit.cause)}`);
          return;
        }

        updateLocalNostrMessage(pendingId, {
          createdAtSec: exit.value.sentAt,
          rumorId: exit.value.rumorId,
        });

        const isOffline =
          typeof navigator !== "undefined" && navigator.onLine === false;
        if (isOffline) {
          logIssuedTokenSendTransaction("publish");
          setStatus(t("chatQueued"));
          return;
        }

        const noticeClientId = ClientId.make(makeLocalId());
        try {
          const noticeExit = await sendPaymentNotice(
            new PaymentNoticeDraft({
              to: contactPubHex,
              clientId: noticeClientId,
            }),
          );
          const failure = Exit.isFailure(noticeExit)
            ? Cause.failureOption(noticeExit.cause)
            : Option.none();
          logPayStep("payment-notice-publish", {
            anySuccess: Exit.isSuccess(noticeExit),
            clientId: noticeClientId,
            error: Option.isSome(failure) ? failure.value._tag : null,
            wrapId: Exit.isSuccess(noticeExit)
              ? noticeExit.value.recipientCopy.wrapId
              : null,
          });
        } catch (error) {
          logPayStep("payment-notice-publish", {
            anySuccess: false,
            clientId: noticeClientId,
            error: getUnknownErrorMessage(error, "publish failed"),
            wrapId: null,
          });
        }

        logIssuedTokenSendTransaction("complete");
      } catch (error) {
        setStatus(`${t("errorPrefix")}: ${String(error ?? "unknown")}`);
      }
    },
    [
      appendLocalNostrMessage,
      cashuTokensAllFiltered,
      currentNsec,
      enqueueOutbox,
      logPaymentEvent,
      deleteCashuToken,
      sendPaymentNotice,
      setStatus,
      t,
      updateLocalNostrMessage,
    ],
  );

  const handleMintIconLoad = React.useCallback(
    (origin: string, url: string | null) => {
      setMintIconUrlByMint((prev) => ({
        ...prev,
        [origin]: url,
      }));
    },
    [setMintIconUrlByMint],
  );

  const handleMintIconError = React.useCallback(
    (origin: string, url: string | null) => {
      setMintIconUrlByMint((prev) => ({
        ...prev,
        [origin]: url,
      }));
    },
    [setMintIconUrlByMint],
  );

  const restoreMissingTokens = useRestoreMissingTokens({
    cashuIsBusy,
    cashuTokensAll: cashuTokensAllFiltered,
    defaultMintUrl,
    enqueueCashuOp,
    isMintDeleted,
    logPaymentEvent,
    mintInfoDeduped,
    pushToast,
    readSeenMintsFromStorage,
    rememberSeenMint,
    restoreCashuTokens,
    setCashuIsBusy,
    setTokensRestoreIsBusy,
    t,
    tokensRestoreIsBusy,
  });

  const mainMintForTokenList = React.useMemo(
    () => normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL),
    [defaultMintUrl],
  );

  const largestForeignMintForTokenList = React.useMemo(() => {
    if (!mainMintForTokenList) return null;

    let selected: { mint: string; sum: number } | null = null;
    for (const [mint, sum] of cashuAcceptedMintBalances) {
      if (mint === mainMintForTokenList || sum <= 0) continue;
      if (!selected || sum > selected.sum) {
        selected = { mint, sum };
      }
    }

    return selected;
  }, [cashuAcceptedMintBalances, mainMintForTokenList]);

  const cashuMeltToMainMintButtonLabel =
    mainMintForTokenList && largestForeignMintForTokenList
      ? t("cashuMeltToMainMint").replace(
          "{mint}",
          formatMintHost(mainMintForTokenList),
        )
      : null;

  const emitCashuToken = React.useCallback(async () => {
    const amountSat = Number.parseInt(cashuEmitAmount.trim(), 10);
    if (!Number.isFinite(amountSat) || amountSat <= 0) {
      setStatus(t("payInvalidAmount"));
      return;
    }

    if (cashuIsBusy) return;
    if (cashuBalance < amountSat) {
      setStatus(t("payInsufficient"));
      return;
    }
    if (sendCashuToken === null) {
      setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
      return;
    }

    const logEmitFailure = (error: string, mint: string | null): void => {
      logPaymentEvent({
        direction: "out",
        status: "error",
        amount: amountSat,
        fee: null,
        mint,
        unit: "sat",
        error,
        contactId: null,
        method: "unknown",
        phase: "swap",
      });
    };

    setCashuIsBusy(true);
    setStatus(t("cashuEmitting"));

    try {
      const mint = selectSendMintForAmount(
        walletBalances.perMint,
        normalizeMintUrl(defaultMintUrl ?? ""),
        amountSat,
      );
      if (mint === null) {
        setStatus(t("payInsufficient"));
        return;
      }

      const outcome = await sendCashuToken({
        amountSat,
        mint,
        produceAs: "issued",
      });
      if (Either.isLeft(outcome)) {
        const sendError = outcome.left;
        const errorMessage =
          describeTaggedCashuError(sendError) ?? sendError._tag;
        logEmitFailure(errorMessage, mint);
        setStatus(
          sendError._tag === "InsufficientFunds"
            ? t("payInsufficient")
            : `${t("payFailed")}: ${errorMessage}`,
        );
        return;
      }

      const receipt = outcome.right;
      logPaymentEvent({
        direction: "out",
        status: "ok",
        amount: receipt.amount,
        details: {
          issuedToken: receipt.tokenText,
        },
        fee: null,
        mint: receipt.mint,
        unit: receipt.unit,
        error: null,
        contactId: null,
        method: "unknown",
        phase: "swap",
      });

      setCashuEmitAmount("");
      setStatus(null);
      const routeId = CashuTokenIdFromUnknown.fromUnknown(receipt.rowId);
      navigateTo(
        routeId.ok
          ? { route: "cashuToken", id: routeId.value }
          : { route: "cashuTokens" },
      );
    } catch (error) {
      const errorMessage = getUnknownErrorMessage(error, "unknown");
      logEmitFailure(errorMessage, null);
      setStatus(`${t("payFailed")}: ${errorMessage}`);
    } finally {
      setCashuIsBusy(false);
    }
  }, [
    cashuBalance,
    cashuEmitAmount,
    cashuIsBusy,
    defaultMintUrl,
    logPaymentEvent,
    sendCashuToken,
    setCashuEmitAmount,
    setStatus,
    t,
    walletBalances.perMint,
  ]);

  const meltLargestForeignMintToMainMint = React.useCallback(async () => {
    if (cashuIsBusy) return;

    const targetMint = normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL);
    if (!targetMint) {
      setStatus(t("mintUrlInvalid"));
      return;
    }

    const source = largestForeignMintForTokenList;
    if (!source || autoswapCashu === null) {
      setStatus(t("cashuMeltToMainMintUnavailable"));
      return;
    }

    setCashuIsBusy(true);
    setStatus(t("cashuMeltToMainMintProcessing"));
    try {
      rememberSeenMint(targetMint);
      const outcome = await autoswapCashu({
        sourceMint: source.mint,
        targetMint,
      });

      if (Either.isRight(outcome)) {
        const moved = formatDisplayedAmountParts(outcome.right.movedAmount);
        setStatus(
          t("cashuMeltToMainMintDone")
            .replace("{amount}", `${moved.approxPrefix}${moved.amountText}`)
            .replace("{unit}", moved.unitLabel)
            .replace("{mint}", formatMintHost(targetMint)),
        );
        return;
      }

      const error = outcome.left;
      // PaymentFailed carrying the target mint means the melt already paid
      // the target's invoice but the claim did not finish; the persisted
      // pending claim completes it via resumePendingClaims.
      if (
        error._tag === "PaymentFailed" &&
        normalizeMintUrl(error.mint) === targetMint
      ) {
        const pending = formatDisplayedAmountParts(source.sum);
        setStatus(
          t("cashuMeltToMainMintPending")
            .replace("{amount}", `${pending.approxPrefix}${pending.amountText}`)
            .replace("{unit}", pending.unitLabel),
        );
        return;
      }

      setStatus(
        `${t("cashuMeltToMainMintFailed")}: ${
          describeTaggedCashuError(error) ?? error._tag
        }`,
      );
    } catch (error) {
      setStatus(
        `${t("cashuMeltToMainMintFailed")}: ${getUnknownErrorMessage(
          error,
          "unknown",
        )}`,
      );
    } finally {
      setCashuIsBusy(false);
    }
  }, [
    autoswapCashu,
    cashuIsBusy,
    defaultMintUrl,
    formatDisplayedAmountParts,
    largestForeignMintForTokenList,
    rememberSeenMint,
    setCashuIsBusy,
    setStatus,
    t,
  ]);

  React.useEffect(() => {
    meltLargestForeignMintToMainMintRef.current =
      meltLargestForeignMintToMainMint;
  }, [meltLargestForeignMintToMainMint]);

  const closePaymentMintMeltConfirmation = React.useCallback(() => {
    if (cashuIsBusy) return;
    setPendingPaymentMintMeltConfirmation(null);
  }, [cashuIsBusy]);

  const confirmPaymentMintMelt = React.useCallback(async () => {
    if (cashuIsBusy) return;
    setPendingPaymentMintMeltConfirmation(null);
    await meltLargestForeignMintToMainMintRef.current();
  }, [cashuIsBusy]);

  useResumeOnLaunchAndOnline(
    React.useMemo(() => {
      if (resumePendingCashuAutoswapClaims === null) return null;
      return () => {
        void resumePendingCashuAutoswapClaims().catch((error: unknown) => {
          console.warn("[linky][autoswap] resumePendingClaims failed", error);
        });
      };
    }, [resumePendingCashuAutoswapClaims]),
  );

  const requestSelectedContact = React.useCallback(async () => {
    if (route.kind !== "contactPay") return;
    if (!selectedContact) return;

    const amountSat = Number.parseInt(payAmount.trim(), 10);
    if (!Number.isFinite(amountSat) || amountSat <= 0) {
      setStatus(t("payInvalidAmount"));
      return;
    }

    const normalizedNpub = normalizeNpubIdentifier(selectedContact.npub ?? "");
    if (!normalizedNpub) {
      setStatus(t("chatMissingContactNpub"));
      return;
    }

    const recipientPubkeyHex = decodeNpub(currentNpub ?? "");

    if (!recipientPubkeyHex) {
      setStatus(t("profileMissingNpub"));
      return;
    }

    const recipientNprofile = encodeNprofile(recipientPubkeyHex, NOSTR_RELAYS);
    const preferredMint =
      normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL) ?? MAIN_MINT_URL;
    const requestId = makeLocalId();
    const requestText = buildCashuPaymentRequestMessage({
      amount: amountSat,
      mintUrls: [preferredMint],
      recipientNprofile,
      requestId,
    });

    await sendChatMessage({
      clearDraft: false,
      text: requestText,
    });

    logPaymentEvent({
      amount: amountSat,
      contactId: route.id,
      details: {
        mintUrls: [preferredMint],
        recipientNprofile,
        requestId,
        requestText,
      },
      direction: "in",
      method: "cashu_chat",
      mint: preferredMint,
      note: t("requestPaymentLabel"),
      status: "ok",
      unit: "sat",
    });

    if ((contactPayBackToChatRef.current ?? "") === route.id) {
      navigateTo({ route: "chat", id: route.id });
      return;
    }

    navigateTo({ route: "contact", id: route.id });
  }, [
    contactPayBackToChatRef,
    currentNpub,
    defaultMintUrl,
    payAmount,
    route,
    selectedContact,
    sendChatMessage,
    logPaymentEvent,
    setStatus,
    t,
  ]);

  const onPayChatPaymentRequest = React.useCallback(
    async (
      message: LocalNostrMessage,
      requestInfo: CashuPaymentRequestMessageInfo,
    ) => {
      if (cashuIsBusy) return;
      if (!selectedChatContact || selectedChatContact.isUnknownContact) return;
      if (!selectedContact) return;

      const requestRumorId = (message.rumorId ?? "").trim();
      if (!requestRumorId) return;

      setCashuIsBusy(true);
      try {
        await payContactWithCashuMessage({
          contact: selectedContact,
          amountSat: requestInfo.amount,
          paymentRequestId: requestInfo.requestId,
          replyContext: {
            replyToId: requestRumorId,
            rootMessageId:
              (message.rootMessageId ?? "").trim() || requestRumorId,
            replyToContent: message.content.trim() || null,
          },
        });
      } finally {
        setCashuIsBusy(false);
      }
    },
    [
      cashuIsBusy,
      payContactWithCashuMessage,
      selectedChatContact,
      selectedContact,
      setCashuIsBusy,
    ],
  );

  const getCashuTokenMessageInfo = React.useCallback(
    (text: string) =>
      getCashuTokenMessageInfoBase(text, cashuTokensAllFiltered),
    [cashuTokensAllFiltered],
  );

  const knownLnAddressPayContact = React.useMemo(() => {
    if (route.kind !== "lnAddressPay") return null;

    const inferredLnAddress = inferLightningAddressFromLnurlTarget(
      route.lnAddress,
    );
    if (!inferredLnAddress) return null;

    return (
      contacts.find(
        (contact) =>
          (contact.lnAddress ?? "").trim().toLowerCase() ===
          inferredLnAddress.toLowerCase(),
      ) ?? null
    );
  }, [contacts, route]);
  const knownLnAddressPayContactPictureUrl = React.useMemo(() => {
    const npub = normalizeNpubIdentifier(knownLnAddressPayContact?.npub ?? "");
    return npub ? (nostrPictureByNpub[npub] ?? null) : null;
  }, [knownLnAddressPayContact, nostrPictureByNpub]);

  return {
    applyDefaultMintSelection,
    canPayWithCashu,
    cancelPendingCashuContactSend,
    cashuBalance,
    cashuBalanceAfterMelt,
    cashuBulkCheckIsBusy,
    cashuDraft,
    cashuDraftRef,
    cashuEmitAmount,
    cashuHasMultipleAcceptedMints,
    cashuIsBusy,
    cashuIssuedTokens,
    cashuMeltToMainMintButtonLabel,
    cashuOwnSpentTokens,
    cashuOwnTokens,
    cashuTokensAllFiltered,
    cashuTokensFiltered,
    cashuTokensHydratedRef,
    cashuTotalBalance,
    checkAllCashuTokensAndDeleteInvalid,
    checkAndRefreshCashuToken,
    checkIssuedCashuTokensAndDeleteClaimed,
    checkSingleIssuedCashuTokenIsClaimed,
    closeLightningInvoiceConfirmation,
    closeLnurlWithdrawConfirmation,
    closePaymentMintMeltConfirmation,
    confirmLightningInvoicePayment,
    confirmLnurlWithdraw,
    confirmPaymentMintMelt,
    contactPayMethod,
    defaultMintDisplay,
    defaultMintUrl,
    defaultMintUrlDraft,
    deleteSpentCashuTokens,
    deleteSpentCashuTokensIsBusy,
    dismissWalletWarning,
    emitCashuToken,
    getCashuTokenMessageInfo,
    getMintIconUrl,
    getMintRuntime,
    handleMintIconError,
    handleMintIconLoad,
    isCashuTokenKnownAny,
    isCashuTokenStored,
    knownLnAddressPayContact,
    knownLnAddressPayContactPictureUrl,
    lightningInvoiceAutoPayLimit,
    lnAddressPayAmount,
    lnurlWithdrawIsBusy,
    makeNip98AuthHeader,
    markCashuTokenExternalized,
    markCashuTokenIssued,
    meltLargestForeignMintToMainMint,
    mintInfoByUrl,
    onPayChatPaymentRequest,
    paidOverlayIsOpen,
    paidOverlayTitle,
    payCashuPaymentRequest,
    payLightningAddressWithCashu,
    payLightningInvoiceWithCashu,
    paySelectedContact,
    payWithCashuEnabled,
    pendingCashuContactSend,
    pendingCashuDeleteId,
    pendingCashuTokenContactPickId,
    pendingLightningInvoiceConfirmation,
    pendingLnurlWithdrawConfirmation,
    pendingMintDeleteUrl,
    pendingPaymentMintMeltConfirmation,
    postPaySaveContact,
    probeLightningFee,
    refreshMintInfo,
    requestDeleteCashuToken,
    requestSelectedContact,
    reserveCashuToken,
    restoreMissingTokens,
    returnCashuTokenToWallet,
    saveCashuFromText,
    sendCashuTokenToContact,
    setCashuDraft,
    setCashuEmitAmount,
    setContactPayMethod,
    setDefaultMintUrlDraft,
    setLightningInvoiceAutoPayLimit,
    setLnAddressPayAmount,
    setMintIconUrlByMint,
    setMintInfoAll,
    setPayWithCashuEnabled,
    setPendingCashuDeleteId,
    setPendingLightningInvoiceConfirmation,
    setPendingLnurlWithdrawConfirmation,
    setPendingMintDeleteUrl,
    setPostPaySaveContact,
    setTopupAmount,
    settleBankPaymentOffer,
    showPaidOverlay,
    startSendCashuTokenToContact,
    tokensRestoreIsBusy,
    topupAmount,
    topupInvoice,
    topupInvoiceCashuRequest,
    topupInvoiceError,
    topupInvoiceIsBusy,
    topupInvoiceQr,
    topupInvoiceQrPayload,
    topupMintUrl,
    walletWarningApplies,
    walletWarningDismissed,
  };
};
