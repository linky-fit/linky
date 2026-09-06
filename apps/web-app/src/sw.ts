/// <reference lib="es2020" />
/// <reference lib="dom" />
/// <reference lib="webworker" />

const SW_BUILD_TAG = "linky-sw-2026-08-14T00:00-linkstr-wrap-fetch";
const NOTIFICATION_OPEN_URL = "/#contacts";
const NOTIFICATION_OPEN_HASH_PARAM = "notificationOpen";

import { getUnknownErrorMessage, isRecord } from "./utils/unknown";
import {
  encodeNpub,
  identityFromNsec,
  NostrSecretKey,
  parsePubkey,
  RelayUrl,
  runLinkstr,
  WrapId,
  WrapInbox,
} from "@linky/linkstr";
import type { ChatMessageReceived, WrapInboxEvent } from "@linky/linkstr";
import { Effect, Schema } from "effect";
import { createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { ExpirationPlugin } from "workbox-expiration";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { normalizePubkeyHex } from "./app/hooks/messages/contactIdentity";
import { getLinkyBankPaymentOfferMessageText } from "./app/lib/bankPaymentOffer";
import { extractCashuTokenFromText } from "./app/lib/tokenText";
import {
  getBankPaymentReimbursementCopyForLanguage,
  getChatAttachmentCopyForLanguage,
  getReceivedMoneyCopyForLanguage,
} from "./app/lib/cashuNotificationCopy";
import { NOSTR_RELAYS } from "./utils/nostrRelays";
import { getStoredPushContactName } from "./utils/pushContactNamesStorage";
import { appendPushDebugLog, flushPushDebugLog } from "./utils/pushDebugLog";
import { getStoredPushNsec } from "./utils/pushNsecStorage";
import { formatShortNpub } from "./utils/formatting";

declare const self: ServiceWorkerGlobalScope;

// The OS push-event deadline is short: a silent relay must not hold the
// wrap fetch past it.
const WRAP_FETCH_TIMEOUT_MS = 5000;

const isRelayUrl = Schema.is(RelayUrl);
const isWrapId = Schema.is(WrapId);

type PushNotificationData = {
  createdAt?: number;
  outerEventId?: string;
  recipientNpub?: string;
  recipientPubkey?: string;
  relayHints?: string[];
  senderPubkey?: string;
  type?: string;
};

type PushNotificationEnvelope = {
  body?: string;
  data?: PushNotificationData;
  title?: string;
};

interface DecryptedPushMessage {
  body: string;
  isCashu: boolean;
  isPaymentNotice: boolean;
  senderPub: string;
}

function readPushNotificationData(value: unknown): PushNotificationData {
  if (!isRecord(value)) {
    return {};
  }

  return {
    ...(typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
      ? { createdAt: value.createdAt }
      : {}),
    ...(typeof value.outerEventId === "string" && value.outerEventId.trim()
      ? { outerEventId: value.outerEventId }
      : {}),
    ...(typeof value.recipientNpub === "string" && value.recipientNpub.trim()
      ? { recipientNpub: value.recipientNpub }
      : {}),
    ...(typeof value.recipientPubkey === "string" &&
    value.recipientPubkey.trim()
      ? { recipientPubkey: value.recipientPubkey }
      : {}),
    ...(Array.isArray(value.relayHints)
      ? {
          relayHints: value.relayHints.filter(
            (entry): entry is string =>
              typeof entry === "string" && entry.trim().length > 0,
          ),
        }
      : {}),
    ...(typeof value.senderPubkey === "string" && value.senderPubkey.trim()
      ? { senderPubkey: value.senderPubkey }
      : {}),
    ...(typeof value.type === "string" && value.type.trim().length > 0
      ? { type: value.type }
      : {}),
  };
}

function buildNotificationOpenDetail(
  data: PushNotificationData,
): Record<string, unknown> {
  return {
    route: "#contacts",
    ...data,
  };
}

function buildNotificationOpenUrl(data: PushNotificationData): string {
  const params = new URLSearchParams({
    [NOTIFICATION_OPEN_HASH_PARAM]: JSON.stringify(
      buildNotificationOpenDetail(data),
    ),
  });
  return `${NOTIFICATION_OPEN_URL}?${params.toString()}`;
}

async function postClientMessage(
  message: Record<string, unknown>,
): Promise<void> {
  const clientList = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of clientList) {
    client.postMessage(message);
  }
}

async function getWindowClients(): Promise<readonly WindowClient[]> {
  return self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
}

function hasVisibleWindowClient(clientList: readonly WindowClient[]): boolean {
  return clientList.some(
    (client) => client.focused || client.visibilityState === "visible",
  );
}

function logSw(message: string, details?: unknown): void {
  appendPushDebugLog("sw", message, details);
}

function readPushEnvelope(value: unknown): PushNotificationEnvelope | null {
  if (!isRecord(value)) return null;

  const data = readPushNotificationData(value.data);

  return {
    ...(typeof value.body === "string" && value.body.trim().length > 0
      ? { body: value.body }
      : {}),
    ...(Object.keys(data).length > 0 ? { data } : {}),
    ...(typeof value.title === "string" && value.title.trim().length > 0
      ? { title: value.title }
      : {}),
  };
}

function truncateNotificationBody(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 140) {
    return normalized;
  }
  return `${normalized.slice(0, 140)}…`;
}

function formatNotificationPeerLabel(pubkeyHex: string): string {
  const normalized = pubkeyHex.trim();
  if (!normalized) return "";

  const pubkey = parsePubkey(normalized);
  return formatShortNpub(pubkey ? encodeNpub(pubkey) : normalized);
}

function buildNotificationTitle(
  envelope: PushNotificationEnvelope,
  decryptedMessage: DecryptedPushMessage | null,
  senderContactName: string | null,
): string {
  const contactName = (senderContactName ?? "").trim();
  if (contactName) return `Linky - ${contactName}`;

  const senderLabel = decryptedMessage
    ? formatNotificationPeerLabel(decryptedMessage.senderPub)
    : "";
  if (senderLabel) return `Linky - ${senderLabel}`;

  const recipientLabel = formatShortNpub(
    envelope.data?.recipientNpub ?? envelope.data?.recipientPubkey ?? "",
  );
  return recipientLabel
    ? `Linky - ${recipientLabel}`
    : (envelope.title ?? "Linky");
}

function sanitizeSpaydFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function createSpaydResponse(url: URL): Response {
  const payload = url.searchParams.get("data") || "";
  const type =
    url.searchParams.get("type") || "application/x-shortpaymentdescriptor";
  const filename = sanitizeSpaydFilename(
    url.searchParams.get("filename") || "platba.spayd",
  );
  const disposition =
    url.searchParams.get("disposition") === "attachment"
      ? "attachment"
      : "inline";

  return new Response(payload, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Content-Type": `${type}; charset=utf-8`,
    },
  });
}

async function fetchWrapInboxEvent(
  envelope: PushNotificationEnvelope,
  secretKey: NostrSecretKey,
): Promise<WrapInboxEvent | null> {
  const outerEventId = (envelope.data?.outerEventId ?? "").trim();
  if (!isWrapId(outerEventId)) {
    logSw("sw decrypt fetch skipped because push envelope is incomplete", {
      data: envelope.data ?? {},
    });
    return null;
  }

  const readRelays = NOSTR_RELAYS.filter(isRelayUrl);
  const extraRelays = (envelope.data?.relayHints ?? []).filter(isRelayUrl);
  const relays = Array.from(new Set([...readRelays, ...extraRelays]));
  if (relays.length === 0) {
    logSw("sw decrypt fetch skipped because no relays were available", {
      data: envelope.data ?? {},
    });
    return null;
  }

  logSw("sw decrypt fetching outer wrap", {
    data: envelope.data ?? {},
    relayCount: relays.length,
    relays,
  });

  try {
    const event = await runLinkstr(
      { secretKey, readRelays },
      Effect.flatMap(WrapInbox, (inbox) =>
        inbox.fetchWrapEvent(outerEventId, {
          extraRelays,
          timeout: WRAP_FETCH_TIMEOUT_MS,
        }),
      ),
    );
    logSw("sw decrypt outer wrap fetch completed", {
      data: envelope.data ?? {},
      found: event !== null,
      routedTag: event?._tag ?? null,
    });
    return event;
  } catch (error) {
    logSw("sw decrypt outer wrap fetch failed", {
      data: envelope.data ?? {},
      error: getUnknownErrorMessage(error, ""),
    });
    return null;
  }
}

function buildChatPushMessage(
  event: ChatMessageReceived,
): DecryptedPushMessage | null {
  const { body } = event;
  if (
    body._tag === "TokenBody" ||
    (body._tag === "TextBody" && extractCashuTokenFromText(body.text) !== null)
  ) {
    return {
      body: getReceivedMoneyCopyForLanguage(self.navigator.language),
      isCashu: true,
      isPaymentNotice: false,
      senderPub: event.from,
    };
  }
  if (body._tag === "ImageBody") {
    return {
      body: getChatAttachmentCopyForLanguage(
        self.navigator.language,
        body.image.fileType === "application/pdf" ? "pdf" : "image",
      ),
      isCashu: false,
      isPaymentNotice: false,
      senderPub: event.from,
    };
  }
  if (body._tag !== "TextBody") return null;
  return {
    body: truncateNotificationBody(body.text),
    isCashu: false,
    isPaymentNotice: false,
    senderPub: event.from,
  };
}

function buildDecryptedPushMessage(
  event: WrapInboxEvent,
): DecryptedPushMessage | null {
  switch (event._tag) {
    case "PaymentNoticeReceived":
      return {
        body:
          event.context === "bank_payment_offer"
            ? getBankPaymentReimbursementCopyForLanguage(
                self.navigator.language,
              )
            : getReceivedMoneyCopyForLanguage(self.navigator.language),
        isCashu: false,
        isPaymentNotice: true,
        senderPub: event.from,
      };
    case "BankOfferSnapshotReceived":
      return {
        body:
          event.text ??
          getLinkyBankPaymentOfferMessageText(event.amountText, event.status),
        isCashu: false,
        isPaymentNotice: false,
        senderPub: event.from,
      };
    case "ChatMessageReceived":
      return buildChatPushMessage(event);
    // Own-copy confirmations, reactions and dropped wraps fall back to the
    // caller's generic notification, like every undecryptable push.
    default:
      return null;
  }
}

async function decryptIncomingMessageBody(
  envelope: PushNotificationEnvelope,
): Promise<DecryptedPushMessage | null> {
  logSw("sw decrypt started", {
    data: envelope.data ?? {},
  });

  const nsec = await getStoredPushNsec();
  if (!nsec) {
    logSw("sw decrypt failed because nsec is missing from indexeddb", {
      data: envelope.data ?? {},
    });
    return null;
  }

  const identity = identityFromNsec(nsec);
  if (!identity) {
    logSw("sw decrypt failed because stored nsec is invalid", {
      data: envelope.data ?? {},
    });
    return null;
  }

  const { pubkey: myPubHex, secretKey } = identity;
  const recipientPubkey = normalizePubkeyHex(envelope.data?.recipientPubkey);
  if (!recipientPubkey || recipientPubkey !== myPubHex) {
    logSw("sw decrypt failed because recipient pubkey did not match", {
      data: envelope.data ?? {},
      derivedPubkey: myPubHex,
      hasRecipientPubkey: Boolean(recipientPubkey),
    });
    return null;
  }

  const event = await fetchWrapInboxEvent(envelope, secretKey);
  if (event === null) {
    logSw("sw decrypt failed because outer wrap event was not fetched", {
      data: envelope.data ?? {},
    });
    return null;
  }

  const message = buildDecryptedPushMessage(event);
  if (message === null) {
    logSw("sw decrypt produced no notification copy for routed event", {
      data: envelope.data ?? {},
      routedTag: event._tag,
    });
    return null;
  }

  logSw("sw decrypt succeeded", {
    data: envelope.data ?? {},
    isCashuMessage: message.isCashu,
    isPaymentNotice: message.isPaymentNotice,
    senderPub: message.senderPub,
  });
  return message;
}

precacheAndRoute(self.__WB_MANIFEST || []);

registerRoute(
  ({ request }: { request: Request }) => request.destination === "image",
  new CacheFirst({
    cacheName: "linky-runtime-images-v1",
    plugins: [
      // @ts-expect-error workbox-expiration declares lifecycle callbacks as required `T | undefined`, incompatible with exactOptionalPropertyTypes
      new ExpirationPlugin({
        maxAgeSeconds: 7 * 24 * 60 * 60,
        maxEntries: 200,
        purgeOnQuotaError: true,
      }),
    ],
  }),
);

registerRoute(
  ({ url }) => url.pathname.endsWith("/platba.spayd"),
  async ({ url }) => createSpaydResponse(url),
);

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    // Dev inspector page and collector endpoints must reach the dev server.
    denylist: [
      /^\/password-save\.html$/,
      /^\/inspector\.html/,
      /^\/__inspector\//,
    ],
  }),
);

// Debug entries are written in batches; lifecycle handlers hold the worker
// open until the batch lands so a stopped worker does not lose them.
self.addEventListener("install", (event) => {
  logSw("service worker install", { build: SW_BUILD_TAG });
  event.waitUntil(flushPushDebugLog());
});

// vite-plugin-pwa registerType:"prompt" — the client posts SKIP_WAITING when
// the user accepts the update banner; without this the new SW would sit in
// the waiting state forever.
self.addEventListener("message", (event: ExtendableMessageEvent) => {
  const data: unknown = event.data;
  if (
    data &&
    typeof data === "object" &&
    "type" in data &&
    data.type === "SKIP_WAITING"
  ) {
    void self.skipWaiting();
  }
  // Lets a freshly loaded tab check whether it is the only open client
  // before silently applying a pending update (see utils/pwaUpdate.ts).
  if (
    data &&
    typeof data === "object" &&
    "type" in data &&
    data.type === "CLIENT_COUNT"
  ) {
    const port = event.ports[0];
    if (!port) return;
    event.waitUntil(
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clientList) => {
          port.postMessage({ count: clientList.length });
        }),
    );
  }
});

self.addEventListener("activate", (event) => {
  logSw("service worker activate");
  event.waitUntil(Promise.all([self.clients.claim(), flushPushDebugLog()]));
});

self.addEventListener("error", (event: ErrorEvent) => {
  logSw("service worker error", {
    filename: event.filename,
    line: event.lineno,
    message: event.message,
  });
});

self.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
  logSw("service worker unhandled rejection", {
    reason: getUnknownErrorMessage(event.reason, ""),
  });
});

self.addEventListener("push", (event) => {
  if (!event.data) {
    logSw("push event without data");
    event.waitUntil(flushPushDebugLog());
    return;
  }

  let envelope: PushNotificationEnvelope | null = null;
  try {
    envelope = readPushEnvelope(event.data.json());
  } catch (error) {
    logSw("push event JSON parse failed", {
      error: getUnknownErrorMessage(error, ""),
    });
    envelope = null;
  }
  if (!envelope) {
    logSw("push event ignored because envelope was invalid");
    event.waitUntil(flushPushDebugLog());
    return;
  }

  const data = envelope.data ?? { type: "nostr_inbox" };
  logSw("push event parsed", {
    data,
    title: envelope.title ?? "Linky",
  });

  if ("setAppBadge" in navigator) {
    navigator.setAppBadge().catch(() => {
      // ignore badge failures
    });
  }

  console.info("[linky][sw] push received", data);
  event.waitUntil(
    (async () => {
      const clientList = await getWindowClients();
      const shouldSuppressNotification = hasVisibleWindowClient(clientList);
      if (shouldSuppressNotification) {
        logSw("notification suppressed because app client is visible", {
          data,
          tag: data.outerEventId ?? "linky-inbox",
        });
        await postClientMessage({
          data,
          type: "push-received",
        });
        return;
      }

      const decryptedMessage = await decryptIncomingMessageBody(envelope).catch(
        () => null,
      );
      const fallbackBody =
        typeof envelope.body === "string" && envelope.body.trim().length > 0
          ? truncateNotificationBody(envelope.body)
          : "";
      const notificationBody = decryptedMessage?.body ?? fallbackBody;
      const senderContactName = decryptedMessage
        ? await getStoredPushContactName(decryptedMessage.senderPub).catch(
            () => null,
          )
        : null;
      const notificationTitle = buildNotificationTitle(
        envelope,
        decryptedMessage,
        senderContactName,
      );
      const options: NotificationOptions = {
        badge: "/pwa-192x192.png",
        body: notificationBody,
        data: {
          ...data,
          ...(decryptedMessage
            ? { senderPubkey: decryptedMessage.senderPub }
            : {}),
        },
        icon: "/pwa-192x192.png",
        requireInteraction: false,
        tag: data.outerEventId ?? "linky-inbox",
      };

      logSw("push received", {
        data,
        hasDecryptedBody: Boolean(decryptedMessage),
        hasSenderContactName: Boolean(senderContactName),
        hasWindowClient: clientList.length > 0,
        isCashuMessage: decryptedMessage?.isCashu ?? false,
        isPaymentNotice: decryptedMessage?.isPaymentNotice ?? false,
        shouldSuppressNotification,
        usedFallbackBody: decryptedMessage === null && fallbackBody.length > 0,
        tag: options.tag ?? null,
        title: notificationTitle,
      });
      await Promise.all([
        postClientMessage({
          data,
          type: "push-received",
        }),
        self.registration
          .showNotification(notificationTitle, options)
          .then(() =>
            logSw("notification displayed", {
              data,
              isCashuMessage: decryptedMessage?.isCashu ?? false,
              isPaymentNotice: decryptedMessage?.isPaymentNotice ?? false,
              tag: options.tag ?? null,
              usedFallbackBody:
                decryptedMessage === null && fallbackBody.length > 0,
            }),
          )
          .catch((error) =>
            logSw("notification display failed", {
              data,
              error: getUnknownErrorMessage(error, ""),
            }),
          ),
      ]);
    })().finally(flushPushDebugLog),
  );
});

self.addEventListener("notificationclose", (event) => {
  logSw("notification close", {
    data: event.notification.data ?? null,
    tag: event.notification.tag,
  });
  event.waitUntil(flushPushDebugLog());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if ("clearAppBadge" in navigator) {
    navigator.clearAppBadge().catch(() => {
      // ignore badge failures
    });
  }

  console.info("[linky][sw] notification click");
  const notificationData = readPushNotificationData(event.notification.data);
  const notificationOpenDetail = buildNotificationOpenDetail(notificationData);
  const notificationOpenUrl = buildNotificationOpenUrl(notificationData);

  logSw("notification click", {
    data: event.notification.data ?? null,
    tag: event.notification.tag,
  });
  event.waitUntil(
    Promise.all([
      flushPushDebugLog(),
      postClientMessage({
        detail: notificationOpenDetail,
        type: "notification-open",
      }),
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clientList) => {
          for (const client of clientList) {
            if (client.url && "focus" in client) {
              return client
                .navigate(notificationOpenUrl)
                .then(() => client.focus());
            }
          }
          if (self.clients.openWindow) {
            return self.clients.openWindow(notificationOpenUrl);
          }
        }),
    ]),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  logSw("push subscription change", {
    hadNewSubscription: event.newSubscription !== null,
    hadOldSubscription: event.oldSubscription !== null,
  });
  event.waitUntil(
    Promise.all([
      flushPushDebugLog(),
      postClientMessage({
        hadNewSubscription: event.newSubscription !== null,
        hadOldSubscription: event.oldSubscription !== null,
        type: "push-subscription-change",
      }),
    ]),
  );
});
