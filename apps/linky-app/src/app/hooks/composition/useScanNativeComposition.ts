import { decodeNpub, identityFromNsec, WrapId } from "@linky-fit/linkstr";
import type { WrapInboxEvent } from "@linky-fit/linkstr";
import {
  useAtomSet,
  useAtomValue,
  useLinkstrCommands,
} from "@linky-fit/linkstr-react";
import { Exit, Schema } from "effect";
import React from "react";
import type { ContactsRepository } from "@linky-fit/linksync";
import { navigateTo, useRouting } from "../../../hooks/useRouting";
import { navigateToRoutePath } from "../../../platform/navigation";
import {
  consumePendingIosNativeDeepLinkUrl,
  consumePendingNativeDeepLinkUrl,
  consumePendingNativeNotificationOpenDetail,
  consumePendingNativeNotificationRoute,
  NATIVE_DEEP_LINK_EVENT,
  NATIVE_NOTIFICATION_OPEN_EVENT,
  NATIVE_PUSH_ACTION_EVENT,
} from "../../../platform/nativeBridge";
import { readClipboardText } from "../../../platform/clipboard";
import { PENDING_DEEP_LINK_TEXT_STORAGE_KEY } from "../../../utils/constants";
import { pickFile } from "../../../utils/pickFile";
import { parseNativeDeepLinkUrl } from "../../../utils/deepLinks";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
} from "../../../utils/storage";
import { useStopContactsGuide } from "../guide/useContactsGuideControls";
import { useContactsOnboardingProgress } from "../guide/useContactsOnboardingProgress";
import { buildUnknownContactId } from "../messages/contactIdentity";
import type { DispatchInboxEvent } from "../messages/useLinkstrInboxSync";
import type { LnurlAuthResult } from "../useLnurlAuth";
import type { SiteLoginResult } from "../useSiteLogin";
import { takeSiteLoginHashLink } from "../../../siteLogin";
import { isAnimatedQrFrame } from "../../../utils/animatedQr";
import { useExperimentalFeatures } from "../useExperimentalFeatures";
import { useSetNavIntent } from "../shell/navIntents";
import { useProvideOwnerCommands } from "../shell/ownerCommands";
import { useGuideScannerDomain } from "../useGuideScannerDomain";
import { useScannedTextHandler } from "../useScannedTextHandler";
import {
  consumeNotificationOpenDetailFromHash,
  readNotificationOpenRoute,
  readNotificationOpenTarget,
} from "../../lib/notificationOpenTarget";
import {
  extractCashuTokenFromText,
  extractCashuTokenFromText as extractCashuTokenFromTextFromUrl,
} from "../../lib/tokenText";
import {
  pendingLightningInvoiceAtom,
  pendingLnurlWithdrawAtom,
} from "../../state/shell/confirmations";
import { scanCommandsAtom, scanEntryPointAtom } from "../../state/shell/scan";
import type { useCashuWalletComposition } from "./useCashuWalletComposition";
import type { useContactsMessagingComposition } from "./useContactsMessagingComposition";
import type { Translate } from "../../../i18n";

type CashuWalletCompositionResult = ReturnType<
  typeof useCashuWalletComposition
>;
type ContactsMessagingCompositionResult = ReturnType<
  typeof useContactsMessagingComposition
>;

const isWrapId = Schema.is(WrapId);

const inboxPeerPubkey = (event: WrapInboxEvent): string | null => {
  switch (event._tag) {
    case "ChatMessageReceived":
    case "ChatMessageDeleted":
    case "ReactionAdded":
    case "ReactionRetracted":
    case "PaymentNoticeReceived":
    case "BankOfferSnapshotReceived":
    case "SeenReceiptReceived":
    case "AppMessageReceived":
      return event.from;
    case "OwnChatMessageConfirmed":
    case "OwnChatMessageDeletionConfirmed":
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
  canPayCashuRequest: CashuWalletCompositionResult["canPayCashuRequest"];
  cashuBalance: CashuWalletCompositionResult["cashuBalance"];
  contacts: ContactsMessagingCompositionResult["contacts"];
  contactsLatestRef: ContactsMessagingCompositionResult["contactsLatestRef"];
  contactsOnboardingDismissedSynced: boolean;
  contactsOnboardingHasBackedUpKeys: ContactsMessagingCompositionResult["contactsOnboardingHasBackedUpKeys"];
  contactsOnboardingHasPaid: ContactsMessagingCompositionResult["contactsOnboardingHasPaid"];
  contactsOnboardingHasSentMessage: ContactsMessagingCompositionResult["contactsOnboardingHasSentMessage"];
  contactsRepository: Pick<ContactsRepository, "insert">;
  currentNpub: string | null;
  currentNsec: string | null;
  dispatchInboxEvent: DispatchInboxEvent;
  lightningInvoiceAutoPayLimit: CashuWalletCompositionResult["lightningInvoiceAutoPayLimit"];
  nostrBootstrapReady: ContactsMessagingCompositionResult["nostrBootstrapReady"];
  openNewContactPage: ContactsMessagingCompositionResult["openNewContactPage"];
  payCashuPaymentRequest: CashuWalletCompositionResult["payCashuPaymentRequest"];
  payLightningInvoiceWithCashu: CashuWalletCompositionResult["payLightningInvoiceWithCashu"];
  persistContactsOnboardingDismissed: () => void;
  pushToast: (message: string) => void;
  requestLnurlAuthConfirmation: LnurlAuthResult["requestLnurlAuthConfirmation"];
  requestLinkauthLogin: SiteLoginResult["requestLinkauthLogin"];
  requestSiteLoginConfirmation: SiteLoginResult["requestSiteLoginConfirmation"];
  route: ReturnType<typeof useRouting>;
  saveCashuFromText: CashuWalletCompositionResult["saveCashuFromText"];
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
}

export const useScanNativeComposition = ({
  addNewContactFromIdentifier,
  canPayCashuRequest,
  cashuBalance,
  contacts,
  contactsLatestRef,
  contactsOnboardingDismissedSynced,
  contactsOnboardingHasBackedUpKeys,
  contactsOnboardingHasPaid,
  contactsOnboardingHasSentMessage,
  contactsRepository,
  currentNpub,
  currentNsec,
  dispatchInboxEvent,
  lightningInvoiceAutoPayLimit,
  nostrBootstrapReady,
  openNewContactPage,
  payCashuPaymentRequest,
  payLightningInvoiceWithCashu,
  persistContactsOnboardingDismissed,
  pushToast,
  requestLnurlAuthConfirmation,
  requestLinkauthLogin,
  requestSiteLoginConfirmation,
  route,
  saveCashuFromText,
  setStatus,
  t,
}: UseScanNativeCompositionParams) => {
  const { fetchWrapEvent } = useLinkstrCommands();
  const pendingNotificationOpenDetailsRef = React.useRef<
    QueuedNotificationOpenDetail[]
  >([]);
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

  // The scanner and the scanned text handler need each other; scan results only arrive after commit.
  const scannedTextHandlerRef = React.useRef<
    (rawValue: string) => Promise<void>
  >(async () => {});
  const {
    closeScan,
    cycleScanCamera,
    openScan,
    openReceiveScan,
    openWalletScan,
  } = useGuideScannerDomain({
    cashuBalance,
    contacts,
    contactsOnboardingHasBackedUpKeys,
    contactsOnboardingHasPaid,
    contactsOnboardingHasSentMessage,
    openNewContactPage,
    onScannedText: (rawValue) => scannedTextHandlerRef.current(rawValue),
    pushToast,
    route,
    t,
  });
  const scanEntryPoint = useAtomValue(scanEntryPointAtom);
  const setPendingLightningInvoice = useAtomSet(pendingLightningInvoiceAtom);
  const setPendingLnurlWithdraw = useAtomSet(pendingLnurlWithdrawAtom);
  const handleContactIdentifierScanned = React.useCallback(
    async (identifier: string) => {
      await addNewContactFromIdentifier(identifier);
    },
    [addNewContactFromIdentifier],
  );

  const { experimentalFeatures } = useExperimentalFeatures();
  const openSavedContact = useSetNavIntent("openSavedContactNpub");
  const handleScannedText = useScannedTextHandler<(typeof contacts)[number]>({
    canPayCashuRequest,
    closeScan,
    contacts,
    contactsRepository,
    currentNpub,
    extractCashuTokenFromText,
    keryxEnabled: experimentalFeatures,
    lightningInvoiceAutoPayLimit,
    onContactIdentifierScanned:
      route.kind === "contactNew" ? handleContactIdentifierScanned : null,
    openSavedContact,
    payCashuPaymentRequest,
    payLightningInvoiceWithCashu,
    requestLightningInvoiceConfirmation: setPendingLightningInvoice,
    requestLnurlAuthConfirmation,
    requestLnurlWithdrawConfirmation: setPendingLnurlWithdraw,
    requestLinkauthLogin,
    requestSiteLoginConfirmation,
    saveCashuFromText,
    scanAcceptsBankPayment:
      scanEntryPoint === "send" || route.kind === "manualPay",
    scanEntryPoint,
    setStatus,
    t,
  });

  React.useLayoutEffect(() => {
    scannedTextHandlerRef.current = handleScannedText;
  }, [handleScannedText]);

  useContactsOnboardingProgress({
    cashuBalance,
    contactsCount: contacts.length,
    contactsOnboardingDismissedSynced,
    contactsOnboardingHasBackedUpKeys,
    contactsOnboardingHasPaid,
    contactsOnboardingHasSentMessage,
    persistContactsOnboardingDismissed,
    routeKind: route.kind,
    stopContactsGuide: useStopContactsGuide(),
    t,
  });

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

          navigateTo({ route: "chat", id: knownContactId });
          return true;
        };

        openedFromNotificationData = target.senderPubkey
          ? openKnownNotificationContact(target.senderPubkey)
          : false;

        if (!isWrapId(target.outerEventId)) {
          return openedFromNotificationData;
        }
        const fetched = await fetchWrapEvent({
          wrapId: target.outerEventId,
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
        void dispatchInboxEvent(event, "backfill");
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

        navigateTo({ route: "chat", id: contactId });
        return true;
      } catch {
        return openedFromNotificationData;
      }
    },
    [contactsLatestRef, currentNsec, dispatchInboxEvent, fetchWrapEvent],
  );

  React.useEffect(() => {
    const acceptDeepLinkUrl = (rawUrl: string | null) => {
      if (!rawUrl) return;
      const parsed = parseNativeDeepLinkUrl(rawUrl);
      if (!parsed) {
        return;
      }

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
  }, [updatePendingDeepLinkText]);

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

  // An open app gets a web link as a hash change, not a fresh load.
  React.useEffect(() => {
    const acceptSiteLoginHashLink = () => {
      const link = takeSiteLoginHashLink();
      if (link) updatePendingDeepLinkText(link);
    };
    acceptSiteLoginHashLink();
    window.addEventListener("hashchange", acceptSiteLoginHashLink);
    return () =>
      window.removeEventListener("hashchange", acceptSiteLoginHashLink);
  }, [updatePendingDeepLinkText]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const rawHash = window.location.hash;
    const token = extractCashuTokenFromTextFromUrl(rawHash);
    if (!token) {
      return;
    }

    updatePendingDeepLinkText(`cashu:${token}`);

    navigateToRoutePath(rawHash.slice(1).split("?")[0] ?? "", {
      replace: true,
    });
  }, [updatePendingDeepLinkText]);

  React.useEffect(() => {
    if (!pendingDeepLinkText) {
      return;
    }

    if (!currentNsec) {
      return;
    }

    updatePendingDeepLinkText(null);
    void handleScannedText(pendingDeepLinkText).catch(() => {
      updatePendingDeepLinkText(pendingDeepLinkText);
    });
  }, [
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

  const scanImageFile = React.useCallback(
    async (file: File) => {
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
            if (isAnimatedQrFrame(detectorValue)) {
              pushToast(t("scanAnimatedQrNeedsCamera"));
              return;
            }
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

        // A still frame carries only a slice of an animation; no photo can
        // hold the whole token.
        if (isAnimatedQrFrame(qrValue)) {
          pushToast(t("scanAnimatedQrNeedsCamera"));
          return;
        }

        await handleScannedText(qrValue);
      } catch {
        pushToast(t("scanImageUnsupported"));
      }
    },
    [handleScannedText, pushToast, t],
  );

  const onPickScanImage = React.useCallback(() => {
    void pickFile("image/*").then((file) =>
      file ? scanImageFile(file) : undefined,
    );
  }, [scanImageFile]);

  useProvideOwnerCommands(scanCommandsAtom, {
    closeScan,
    cycleScanCamera,
    handleScannedText,
    onPickScanImage,
    openReceiveScan,
    openScan,
    openWalletScan,
    pasteScanValue,
  });
};
