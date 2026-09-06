import { Share } from "@capacitor/share";
import { decodeNpub, identityFromNsec, RelayUrl, WrapId } from "@linky/linkstr";
import type { WrapInboxEvent } from "@linky/linkstr";
import { fetchWrapEventAtom, useAtomSet } from "@linky/linkstr-react";
import { Exit, Schema } from "effect";
import React from "react";
import type { CashuTokenId, useEvolu } from "../../../evolu";
import { navigateTo, useRouting } from "../../../hooks/useRouting";
import {
  cancelNativeNfcWrite,
  consumePendingIosNativeDeepLinkUrl,
  consumePendingNativeDeepLinkUrl,
  consumePendingNativeNotificationOpenDetail,
  consumePendingNativeNotificationRoute,
  NATIVE_DEEP_LINK_EVENT,
  NATIVE_NOTIFICATION_OPEN_EVENT,
  NATIVE_PUSH_ACTION_EVENT,
  startNativeNfcWrite,
  supportsNativeNfcWrite,
} from "../../../platform/nativeBridge";
import { readClipboardText } from "../../../platform/clipboard";
import { isNativePlatform } from "../../../platform/runtime";
import { PENDING_DEEP_LINK_TEXT_STORAGE_KEY } from "../../../utils/constants";
import {
  buildCashuDeepLink,
  parseNativeDeepLinkUrl,
} from "../../../utils/deepLinks";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
} from "../../../utils/storage";
import { useContactsOnboardingProgress } from "../guide/useContactsOnboardingProgress";
import { buildUnknownContactId } from "../messages/contactIdentity";
import type { DispatchInboxEvent } from "../messages/useLinkstrInboxSync";
import { useGuideScannerDomain } from "../useGuideScannerDomain";
import { useScannedTextHandler } from "../useScannedTextHandler";
import { isCashuTokenAcceptedState } from "../../lib/cashuTokenState";
import {
  consumeNotificationOpenDetailFromHash,
  readNotificationOpenRoute,
  readNotificationOpenTarget,
} from "../../lib/notificationOpenTarget";
import {
  extractCashuTokenFromText,
  extractCashuTokenFromText as extractCashuTokenFromTextFromUrl,
} from "../../lib/tokenText";
import type { useCashuWalletComposition } from "./useCashuWalletComposition";
import type { useContactsMessagingComposition } from "./useContactsMessagingComposition";
import type { useIdentityOwnersComposition } from "./useIdentityOwnersComposition";
import type { Translate } from "../../../i18n";

type CashuWalletCompositionResult = ReturnType<
  typeof useCashuWalletComposition
>;
type ContactsMessagingCompositionResult = ReturnType<
  typeof useContactsMessagingComposition
>;
type EvoluMutations = ReturnType<typeof useEvolu>;
type IdentityOwnersCompositionResult = ReturnType<
  typeof useIdentityOwnersComposition
>;

const isRelayUrl = Schema.is(RelayUrl);
const isWrapId = Schema.is(WrapId);

const inboxPeerPubkey = (event: WrapInboxEvent): string | null => {
  switch (event._tag) {
    case "ChatMessageReceived":
    case "ReactionAdded":
    case "ReactionRetracted":
    case "PaymentNoticeReceived":
    case "BankOfferSnapshotReceived":
    case "SeenReceiptReceived":
      return event.from;
    case "OwnChatMessageConfirmed":
    case "OwnBankOfferSnapshotConfirmed":
    case "OwnSeenReceiptConfirmed":
      return event.to;
    case "OwnReactionConfirmed":
    case "OwnRetractionConfirmed":
    case "WrapDropped":
      return null;
  }
};

interface QueuedNotificationOpenDetail {
  value: unknown;
}

interface UseScanNativeCompositionParams {
  addNewContactFromIdentifier: ContactsMessagingCompositionResult["addNewContactFromIdentifier"];
  cashuBalance: CashuWalletCompositionResult["cashuBalance"];
  cashuOwnerId: IdentityOwnersCompositionResult["cashuOwnerId"];
  cashuTokensAllFiltered: CashuWalletCompositionResult["cashuTokensAllFiltered"];
  contacts: ContactsMessagingCompositionResult["contacts"];
  contactsLatestRef: ContactsMessagingCompositionResult["contactsLatestRef"];
  contactsOnboardingDismissedSynced: boolean;
  contactsOnboardingHasBackedUpKeys: ContactsMessagingCompositionResult["contactsOnboardingHasBackedUpKeys"];
  contactsOnboardingHasPaid: ContactsMessagingCompositionResult["contactsOnboardingHasPaid"];
  contactsOnboardingHasSentMessage: ContactsMessagingCompositionResult["contactsOnboardingHasSentMessage"];
  contactsOwnerId: IdentityOwnersCompositionResult["contactsOwnerId"];
  copyText: (value: string) => Promise<void>;
  currentNpub: string | null;
  currentNsec: string | null;
  dispatchInboxEvent: DispatchInboxEvent;
  insert: EvoluMutations["insert"];
  lightningInvoiceAutoPayLimit: CashuWalletCompositionResult["lightningInvoiceAutoPayLimit"];
  markCashuTokenExternalized: CashuWalletCompositionResult["markCashuTokenExternalized"];
  markCashuTokenIssued: CashuWalletCompositionResult["markCashuTokenIssued"];
  nostrBootstrapReady: ContactsMessagingCompositionResult["nostrBootstrapReady"];
  openNewContactPage: ContactsMessagingCompositionResult["openNewContactPage"];
  openScannedContactPendingNpubRef: ContactsMessagingCompositionResult["openScannedContactPendingNpubRef"];
  payCashuPaymentRequest: CashuWalletCompositionResult["payCashuPaymentRequest"];
  payLightningInvoiceWithCashu: CashuWalletCompositionResult["payLightningInvoiceWithCashu"];
  persistContactsOnboardingDismissed: () => void;
  pushToast: (message: string) => void;
  route: ReturnType<typeof useRouting>;
  saveCashuFromText: CashuWalletCompositionResult["saveCashuFromText"];
  setPendingDeleteId: ContactsMessagingCompositionResult["setPendingDeleteId"];
  setPendingLightningInvoiceConfirmation: CashuWalletCompositionResult["setPendingLightningInvoiceConfirmation"];
  setPendingLnurlWithdrawConfirmation: CashuWalletCompositionResult["setPendingLnurlWithdrawConfirmation"];
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
}

export const useScanNativeComposition = ({
  addNewContactFromIdentifier,
  cashuBalance,
  cashuOwnerId,
  cashuTokensAllFiltered,
  contacts,
  contactsLatestRef,
  contactsOnboardingDismissedSynced,
  contactsOnboardingHasBackedUpKeys,
  contactsOnboardingHasPaid,
  contactsOnboardingHasSentMessage,
  contactsOwnerId,
  copyText,
  currentNpub,
  currentNsec,
  dispatchInboxEvent,
  insert,
  lightningInvoiceAutoPayLimit,
  markCashuTokenExternalized,
  markCashuTokenIssued,
  nostrBootstrapReady,
  openNewContactPage,
  openScannedContactPendingNpubRef,
  payCashuPaymentRequest,
  payLightningInvoiceWithCashu,
  persistContactsOnboardingDismissed,
  pushToast,
  route,
  saveCashuFromText,
  setPendingDeleteId,
  setPendingLightningInvoiceConfirmation,
  setPendingLnurlWithdrawConfirmation,
  setStatus,
  t,
}: UseScanNativeCompositionParams) => {
  const fetchWrapEvent = useAtomSet(fetchWrapEventAtom, {
    mode: "promiseExit",
  });
  const pendingNotificationOpenDetailsRef = React.useRef<
    QueuedNotificationOpenDetail[]
  >([]);
  const [shareOptionsText, setShareOptionsText] = React.useState<string | null>(
    null,
  );
  const [pendingDeepLinkText, setPendingDeepLinkText] = React.useState<
    string | null
  >(() => {
    const stored = (
      safeLocalStorageGet(PENDING_DEEP_LINK_TEXT_STORAGE_KEY) ?? ""
    ).trim();
    return stored || null;
  });

  const updatePendingDeepLinkText = React.useCallback(
    (value: string | null) => {
      const normalized = (value ?? "").trim();

      if (!normalized) {
        safeLocalStorageRemove(PENDING_DEEP_LINK_TEXT_STORAGE_KEY);
        setPendingDeepLinkText(null);
        return;
      }

      safeLocalStorageSet(PENDING_DEEP_LINK_TEXT_STORAGE_KEY, normalized);
      setPendingDeepLinkText(normalized);
    },
    [],
  );

  const scannedTextHandlerRef = React.useRef<
    (rawValue: string) => Promise<void>
  >(async () => {});

  const {
    closeScan,
    contactsGuide,
    contactsGuideActiveStep,
    contactsGuideHighlightRect,
    contactsGuideNav,
    cycleScanCamera,
    openScan,
    openReceiveScan,
    openWalletScan,
    scanAllowsManualContact,
    scanCameraLabel,
    scanCanSwitchCamera,
    scanEntryPoint,
    scanIsOpen,
    scanVideoRef,
    startContactsGuide,
    stopContactsGuide,
  } = useGuideScannerDomain({
    cashuBalance,
    contacts,
    contactsOnboardingHasBackedUpKeys,
    contactsOnboardingHasPaid,
    contactsOnboardingHasSentMessage,
    openNewContactPage,
    onScannedText: (rawValue: string) =>
      scannedTextHandlerRef.current(rawValue),
    pushToast,
    route,
    t,
  });
  const contactsGuideNavRef = React.useRef(contactsGuideNav);
  React.useLayoutEffect(() => {
    contactsGuideNavRef.current = contactsGuideNav;
  }, [contactsGuideNav]);
  const stableContactsGuideNav = React.useMemo(
    () => ({
      back: () => {
        contactsGuideNavRef.current.back();
      },
      next: () => {
        contactsGuideNavRef.current.next();
      },
    }),
    [],
  );

  const openManualContactFromScan = React.useCallback(() => {
    closeScan();
    if (route.kind === "contactNew") return;
    openNewContactPage();
  }, [closeScan, openNewContactPage, route.kind]);

  const scanImageInputRef = React.useRef<HTMLInputElement | null>(null);

  const openIssueTokenFromScan = React.useCallback(() => {
    closeScan();
    if (route.kind === "cashuTokenEmit") return;
    navigateTo({ route: "cashuTokenEmit" });
  }, [closeScan, route.kind]);

  const openManualPayFromScan = React.useCallback(() => {
    closeScan();
    if (route.kind === "manualPay") return;
    navigateTo({ route: "manualPay" });
  }, [closeScan, route.kind]);

  const onPickScanImage = React.useCallback(() => {
    scanImageInputRef.current?.click();
  }, []);

  const {
    contactsOnboardingCelebrating,
    contactsOnboardingTasks,
    dismissContactsOnboarding,
    showContactsOnboarding,
  } = useContactsOnboardingProgress({
    cashuBalance,
    contactsCount: contacts.length,
    contactsOnboardingDismissedSynced,
    contactsOnboardingHasBackedUpKeys,
    contactsOnboardingHasPaid,
    contactsOnboardingHasSentMessage,
    persistContactsOnboardingDismissed,
    routeKind: route.kind,
    stopContactsGuide,
    t,
  });

  const closeShareOptions = React.useCallback(() => {
    setShareOptionsText(null);
  }, []);

  const openShareOptionsUrl = React.useCallback((url: string) => {
    if (typeof window === "undefined") return;
    window.open(url, "_blank", "noopener,noreferrer");
    setShareOptionsText(null);
  }, []);

  const copyShareOptionsText = React.useCallback(async () => {
    const text = (shareOptionsText ?? "").trim();
    if (!text) return;
    await copyText(text);
    setShareOptionsText(null);
  }, [copyText, shareOptionsText]);

  const shareOptionsViaEmail = React.useCallback(() => {
    const text = (shareOptionsText ?? "").trim();
    if (!text) return;
    openShareOptionsUrl(`mailto:?body=${encodeURIComponent(text)}`);
  }, [openShareOptionsUrl, shareOptionsText]);

  const shareOptionsViaSms = React.useCallback(() => {
    const text = (shareOptionsText ?? "").trim();
    if (!text) return;
    openShareOptionsUrl(`sms:?body=${encodeURIComponent(text)}`);
  }, [openShareOptionsUrl, shareOptionsText]);

  const shareOptionsViaWhatsApp = React.useCallback(() => {
    const text = (shareOptionsText ?? "").trim();
    if (!text) return;
    openShareOptionsUrl(`https://wa.me/?text=${encodeURIComponent(text)}`);
  }, [openShareOptionsUrl, shareOptionsText]);

  const shareText = React.useCallback(
    async (value: string) => {
      const text = value.trim();
      if (!text) {
        pushToast(t("errorPrefix"));
        return;
      }

      if (isNativePlatform()) {
        try {
          await Share.share({ text });
          return;
        } catch (error) {
          const errorMessage =
            typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof error.message === "string"
              ? error.message
              : "";
          if (
            /cancel/i.test(errorMessage) ||
            /abort/i.test(errorMessage) ||
            /dismiss/i.test(errorMessage)
          ) {
            return;
          }
          pushToast(t("shareFailed"));
          return;
        }
      }

      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ text });
          return;
        } catch (error) {
          const errorName =
            typeof error === "object" &&
            error !== null &&
            "name" in error &&
            typeof error.name === "string"
              ? error.name
              : "";
          if (errorName === "AbortError") return;
          pushToast(t("shareFailed"));
          return;
        }
      }

      pushToast(t("shareUnavailable"));
    },
    [pushToast, t],
  );

  const canWriteNfc = supportsNativeNfcWrite();
  const [nfcWritePromptKind, setNfcWritePromptKind] = React.useState<
    "profile" | "token" | null
  >(null);
  const nfcWriteCancelledByUserRef = React.useRef(false);

  const cancelPendingNfcWrite = React.useCallback(() => {
    nfcWriteCancelledByUserRef.current = true;
    setNfcWritePromptKind(null);
    cancelNativeNfcWrite();
  }, []);

  const writeNfcUriWithToast = React.useCallback(
    async (
      url: string,
      successKey: "nfcWriteProfileSuccess" | "nfcWriteTokenSuccess",
      promptKind: "profile" | "token",
    ): Promise<boolean> => {
      nfcWriteCancelledByUserRef.current = false;

      const result = await startNativeNfcWrite(url, (progress) => {
        if (progress.status === "armed" && progress.prompt === "web") {
          setNfcWritePromptKind(promptKind);
        }
      });

      setNfcWritePromptKind(null);

      if (result === null || result.status === "unsupported") {
        pushToast(t("nfcWriteUnsupported"));
        return false;
      }

      if (result.status === "success") {
        pushToast(t(successKey));
        return true;
      }

      if (result.status === "disabled") {
        pushToast(t("nfcWriteDisabled"));
        return false;
      }

      if (result.status === "busy") {
        pushToast(t("nfcWriteBusy"));
        return false;
      }

      if (result.status === "cancelled") {
        if (nfcWriteCancelledByUserRef.current) {
          nfcWriteCancelledByUserRef.current = false;
          return false;
        }

        pushToast(t("nfcWriteCancelled"));
        return false;
      }

      nfcWriteCancelledByUserRef.current = false;

      const message = (result.message ?? "").trim();
      pushToast(
        message ? `${t("nfcWriteFailed")}: ${message}` : t("nfcWriteFailed"),
      );

      return false;
    },
    [pushToast, t],
  );

  const writeCashuTokenToNfc = React.useCallback(
    async (id: CashuTokenId, tokenText: string) => {
      const trimmed = tokenText.trim();
      const deepLink = buildCashuDeepLink(trimmed);
      if (!deepLink) {
        pushToast(t("cashuInvalid"));
        return;
      }

      const wrote = await writeNfcUriWithToast(
        deepLink,
        "nfcWriteTokenSuccess",
        "token",
      );

      if (!wrote) return;

      await markCashuTokenExternalized(id);
    },
    [markCashuTokenExternalized, pushToast, t, writeNfcUriWithToast],
  );

  const shareCashuTokenText = React.useCallback(
    async (id: CashuTokenId, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        pushToast(t("cashuInvalid"));
        return;
      }

      const row = cashuTokensAllFiltered.find(
        (candidate) => candidate.id === id && !candidate.isDeleted,
      );
      if (!row) {
        pushToast(t("cashuInvalid"));
        return;
      }

      if (isNativePlatform() || typeof navigator.share === "function") {
        await shareText(trimmed);
      } else {
        setShareOptionsText(trimmed);
      }

      if (isCashuTokenAcceptedState(row.state)) {
        await markCashuTokenIssued(id);
      }
    },
    [cashuTokensAllFiltered, markCashuTokenIssued, pushToast, shareText, t],
  );

  const writeCurrentNpubToNfc = React.useCallback(async () => {
    const npub = normalizeNpubIdentifier(currentNpub ?? "");
    if (!npub) {
      pushToast(t("profileMissingNpub"));
      return;
    }

    await writeNfcUriWithToast(
      `nostr://${npub}`,
      "nfcWriteProfileSuccess",
      "profile",
    );
  }, [currentNpub, pushToast, t, writeNfcUriWithToast]);

  const openNotificationChat = React.useCallback(
    async (rawDetail: unknown): Promise<boolean> => {
      const target = readNotificationOpenTarget(rawDetail);
      if (!target || !currentNsec) {
        return false;
      }

      let openedFromNotificationData = false;
      try {
        const identity = identityFromNsec(currentNsec);
        if (!identity) return false;
        const myPubHex = identity.pubkey;
        if (target.recipientPubkey !== myPubHex) {
          return false;
        }

        const findKnownContact = (peerPubkey: string) =>
          contactsLatestRef.current.find((contact) => {
            const normalizedNpub = normalizeNpubIdentifier(contact.npub ?? "");
            if (!normalizedNpub) {
              return false;
            }

            return decodeNpub(normalizedNpub) === peerPubkey;
          }) ?? null;

        const openKnownNotificationContact = (peerPubkey: string): boolean => {
          const knownContact = findKnownContact(peerPubkey);
          const knownContactId = (knownContact?.id ?? "").trim();
          if (!knownContactId) {
            return false;
          }

          setPendingDeleteId(null);
          navigateTo({ route: "chat", id: knownContactId });
          return true;
        };

        openedFromNotificationData = target.senderPubkey
          ? openKnownNotificationContact(target.senderPubkey)
          : false;

        if (!isWrapId(target.outerEventId)) {
          return openedFromNotificationData;
        }
        const extraRelays = target.relayHints.filter(isRelayUrl);
        const fetched = await fetchWrapEvent({
          wrapId: target.outerEventId,
          ...(extraRelays.length === 0 ? {} : { extraRelays }),
        });
        if (
          Exit.isFailure(fetched) ||
          fetched.value === null ||
          fetched.value._tag === "WrapDropped"
        ) {
          return (
            openedFromNotificationData ||
            (target.senderPubkey
              ? openKnownNotificationContact(target.senderPubkey)
              : false)
          );
        }

        const event = fetched.value;
        dispatchInboxEvent(event, "backfill");
        const peerPubkey = inboxPeerPubkey(event);
        if (!peerPubkey) {
          return openedFromNotificationData;
        }

        const knownContact = findKnownContact(peerPubkey);

        const contactId = knownContact
          ? knownContact.id.trim()
          : (buildUnknownContactId(peerPubkey) ?? "").trim();
        if (!contactId) {
          return false;
        }

        setPendingDeleteId(null);
        navigateTo({ route: "chat", id: contactId });
        return true;
      } catch {
        return openedFromNotificationData;
      }
    },
    [
      contactsLatestRef,
      currentNsec,
      dispatchInboxEvent,
      fetchWrapEvent,
      setPendingDeleteId,
    ],
  );

  const handleContactIdentifierScanned = React.useCallback(
    async (identifier: string) => {
      await addNewContactFromIdentifier(identifier);
    },
    [addNewContactFromIdentifier],
  );

  const handleScannedText = useScannedTextHandler<(typeof contacts)[number]>({
    appOwnerId: contactsOwnerId,
    closeScan,
    contacts,
    currentNpub,
    extractCashuTokenFromText,
    insert,
    lightningInvoiceAutoPayLimit,
    onContactIdentifierScanned:
      route.kind === "contactNew" ? handleContactIdentifierScanned : null,
    openScannedContactPendingNpubRef,
    payCashuPaymentRequest,
    payLightningInvoiceWithCashu,
    requestLightningInvoiceConfirmation: setPendingLightningInvoiceConfirmation,
    requestLnurlWithdrawConfirmation: setPendingLnurlWithdrawConfirmation,
    saveCashuFromText,
    scanAcceptsBankPayment:
      scanEntryPoint === "send" || route.kind === "manualPay",
    scanEntryPoint,
    setStatus,
    t,
  });

  React.useEffect(() => {
    const acceptDeepLinkUrl = (rawUrl: string | null) => {
      if (!rawUrl) return;
      const parsed = parseNativeDeepLinkUrl(rawUrl);
      if (!parsed) {
        return;
      }

      setPendingDeleteId(null);
      updatePendingDeepLinkText(parsed.text);
      consumePendingNativeDeepLinkUrl();
    };

    acceptDeepLinkUrl(consumePendingNativeDeepLinkUrl());
    void consumePendingIosNativeDeepLinkUrl().then(acceptDeepLinkUrl);

    const onDeepLink: EventListener = (event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }

      const detail = event.detail;
      if (typeof detail !== "object" || detail === null) {
        return;
      }

      const url: unknown = Reflect.get(detail, "url");
      if (typeof url === "string") acceptDeepLinkUrl(url);
    };

    window.addEventListener(NATIVE_DEEP_LINK_EVENT, onDeepLink);
    return () => window.removeEventListener(NATIVE_DEEP_LINK_EVENT, onDeepLink);
  }, [setPendingDeleteId, updatePendingDeepLinkText]);

  React.useEffect(() => {
    const openNotificationRoute = (rawRoute: unknown) => {
      const routeValue = readNotificationOpenRoute(rawRoute);
      if (routeValue === "#contacts") {
        navigateTo({ route: "contacts" });
        return;
      }
      if (routeValue === "#wallet") {
        navigateTo({ route: "wallet" });
      }
    };

    const openNotification = (rawDetail: unknown) => {
      if (!nostrBootstrapReady) {
        pendingNotificationOpenDetailsRef.current.push({ value: rawDetail });
        return;
      }

      void openNotificationChat(rawDetail).then((opened) => {
        if (opened) {
          return;
        }

        openNotificationRoute(rawDetail);
      });
    };

    const pendingNotificationDetail =
      consumePendingNativeNotificationOpenDetail();
    const pendingHashNotificationDetail =
      consumeNotificationOpenDetailFromHash();
    if (pendingNotificationDetail) {
      openNotification(pendingNotificationDetail);
    } else if (pendingHashNotificationDetail) {
      openNotification(pendingHashNotificationDetail);
    } else {
      openNotificationRoute(consumePendingNativeNotificationRoute());
    }

    if (nostrBootstrapReady) {
      const queuedDetails = pendingNotificationOpenDetailsRef.current.splice(0);
      for (const detail of queuedDetails) {
        openNotification(detail.value);
      }
    }

    const onNotificationOpen: EventListener = (event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }

      const detail = event.detail;
      if (typeof detail !== "object" || detail === null) {
        return;
      }

      openNotification(detail);
    };

    window.addEventListener(NATIVE_NOTIFICATION_OPEN_EVENT, onNotificationOpen);
    window.addEventListener(NATIVE_PUSH_ACTION_EVENT, onNotificationOpen);
    const onServiceWorkerMessage = (event: MessageEvent) => {
      const data = event.data;
      if (typeof data !== "object" || data === null) {
        return;
      }
      if (Reflect.get(data, "type") !== "notification-open") {
        return;
      }

      openNotification(Reflect.get(data, "detail"));
    };

    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener(
        "message",
        onServiceWorkerMessage,
      );
    }

    return () => {
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener(
          "message",
          onServiceWorkerMessage,
        );
      }

      window.removeEventListener(
        NATIVE_NOTIFICATION_OPEN_EVENT,
        onNotificationOpen,
      );
      window.removeEventListener(NATIVE_PUSH_ACTION_EVENT, onNotificationOpen);
    };
  }, [nostrBootstrapReady, openNotificationChat]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const rawHash = window.location.hash;
    const token = extractCashuTokenFromTextFromUrl(rawHash);
    if (!token) {
      return;
    }

    setPendingDeleteId(null);
    updatePendingDeepLinkText(`cashu:${token}`);

    const cleanHash = rawHash.split("?")[0] ?? "#wallet";
    const nextHash = cleanHash || "#wallet";
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${nextHash}`,
    );
  }, [setPendingDeleteId, updatePendingDeepLinkText]);

  React.useEffect(() => {
    if (!pendingDeepLinkText) {
      return;
    }

    if (!currentNsec || !cashuOwnerId) {
      return;
    }

    updatePendingDeepLinkText(null);
    void handleScannedText(pendingDeepLinkText).catch(() => {
      updatePendingDeepLinkText(pendingDeepLinkText);
    });
  }, [
    cashuOwnerId,
    currentNsec,
    handleScannedText,
    pendingDeepLinkText,
    updatePendingDeepLinkText,
  ]);

  const pasteScanValue = React.useCallback(async () => {
    let text = await readClipboardText();

    if (text === null) {
      if (
        typeof window !== "undefined" &&
        typeof window.prompt === "function"
      ) {
        text = window.prompt(t("scanPastePrompt")) ?? "";
      } else {
        pushToast(t("pasteNotAvailable"));
        return;
      }
    }

    const raw = text.trim();
    if (!raw) {
      pushToast(t("pasteEmpty"));
      return;
    }

    await handleScannedText(raw);
  }, [handleScannedText, pushToast, t]);

  const onScanImageSelected = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const file = input.files?.[0] ?? null;
      input.value = "";

      if (!file) {
        return;
      }

      const loadImage = async (imageFile: File): Promise<HTMLImageElement> => {
        const objectUrl = URL.createObjectURL(imageFile);

        try {
          return await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("image-load-failed"));
            image.src = objectUrl;
          });
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      };

      try {
        const image = await loadImage(file);
        const detectorCtor = window.BarcodeDetector;

        if (detectorCtor) {
          const detector = new detectorCtor({ formats: ["qr_code"] });
          const detectorValue = (
            (await detector.detect(image))?.[0]?.rawValue ?? ""
          ).trim();

          if (detectorValue) {
            await handleScannedText(detectorValue);
            return;
          }
        }

        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (width <= 0 || height <= 0) {
          pushToast(t("scanImageUnsupported"));
          return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          pushToast(t("scanImageUnsupported"));
          return;
        }

        ctx.drawImage(image, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        const jsQr = (await import("jsqr")).default;
        const qrValue = (
          jsQr(imageData.data, width, height)?.data ?? ""
        ).trim();

        if (!qrValue) {
          pushToast(t("scanImageUnsupported"));
          return;
        }

        await handleScannedText(qrValue);
      } catch {
        pushToast(t("scanImageUnsupported"));
      }
    },
    [handleScannedText, pushToast, t],
  );

  const onSubmitManualPayText = React.useCallback(
    async (text: string) => {
      await handleScannedText(text);
    },
    [handleScannedText],
  );

  React.useEffect(() => {
    scannedTextHandlerRef.current = handleScannedText;
  }, [handleScannedText, scannedTextHandlerRef]);

  return {
    cancelPendingNfcWrite,
    canWriteNfc,
    closeScan,
    closeShareOptions,
    contactsGuide,
    contactsGuideActiveStep,
    contactsGuideHighlightRect,
    contactsOnboardingCelebrating,
    contactsOnboardingTasks,
    copyShareOptionsText,
    cycleScanCamera,
    dismissContactsOnboarding,
    nfcWritePromptKind,
    onPickScanImage,
    onScanImageSelected,
    onSubmitManualPayText,
    openIssueTokenFromScan,
    openManualContactFromScan,
    openManualPayFromScan,
    openReceiveScan,
    openScan,
    openWalletScan,
    pasteScanValue,
    scanAllowsManualContact,
    scanCameraLabel,
    scanCanSwitchCamera,
    scanEntryPoint,
    scanImageInputRef,
    scanIsOpen,
    scanVideoRef,
    shareCashuTokenText,
    shareOptionsText,
    shareOptionsViaEmail,
    shareOptionsViaSms,
    shareOptionsViaWhatsApp,
    showContactsOnboarding,
    stableContactsGuideNav,
    startContactsGuide,
    stopContactsGuide,
    writeCashuTokenToNfc,
    writeCurrentNpubToNfc,
  };
};
