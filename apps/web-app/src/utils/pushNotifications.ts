import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
} from "./storage";
import { decodeBase64Url, encodeBase64Url } from "./base64";
import { Option, Schema } from "effect";
import { NonBlankString } from "./schema";
import {
  PushNotifications,
  type PushNotificationActionPerformed,
  type PushNotificationSchema,
  type Token,
} from "@capacitor/push-notifications";
import {
  identityFromNsec,
  makePushOwnershipProof,
  UnixSeconds,
  type NostrSecretKey,
  type SignedPlainEvent,
} from "@linky/linkstr";
import {
  getNativeNotificationPermissionState,
  NATIVE_PUSH_ACTION_EVENT,
  requestNativeNotificationPermission,
} from "../platform/nativeBridge";
import { isNativePlatform } from "../platform/runtime";
import { appendPushDebugLog } from "./pushDebugLog";
import { base64 } from "@scure/base";
import { nowSeconds } from "./time";

const PUSH_SERVER_URL =
  import.meta.env.VITE_PUSH_SERVER_URL ||
  import.meta.env.VITE_NOTIFICATION_SERVER_URL ||
  "https://push.linky.fit";

const VAPID_KEY_STORAGE_KEY = "linky.push_vapid_public_key";
const PUSH_INSTALLATION_ID_STORAGE_KEY = "linky.push_installation_id";
const REGISTERED_PUSH_ENDPOINT_STORAGE_KEY = "linky.push_subscription_endpoint";
const REGISTERED_PUSH_PUBKEY_STORAGE_KEY = "linky.push_subscription_pubkey";
const REGISTERED_NATIVE_PUSH_TOKEN_STORAGE_KEY = "linky.push_native_token";
const REGISTERED_NATIVE_PUSH_PUBKEY_STORAGE_KEY = "linky.push_native_pubkey";
const PUSH_NOTIFICATIONS_DISABLED_STORAGE_KEY =
  "linky.push_notifications_disabled";
let nativePushListenersPromise: Promise<void> | null = null;
const pendingNativePushTokenWaiters = new Set<{
  reject: (error: Error) => void;
  resolve: (token: string) => void;
}>();

async function fetchVapidPublicKey(): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${PUSH_SERVER_URL}/vapid-public-key`);
  } catch (error) {
    appendPushDebugLog("client", "push vapid key fetch failed", {
      error,
      pushServerUrl: PUSH_SERVER_URL,
    });
    throw new Error(
      "Push server je nedostupný. Zkontroluj připojení nebo zkus notifikace zapnout později.",
    );
  }

  if (!response.ok) {
    throw new Error(`Push server vrátil HTTP ${response.status}`);
  }
  const data = decodeVapidPublicKeyResponse(await response.json());
  if (Option.isNone(data)) {
    throw new Error("Push server vrátil neplatný VAPID klíč");
  }
  return data.value.vapidPublicKey;
}

function getOrCreatePushInstallationId(): string {
  const existing = safeLocalStorageGet(PUSH_INSTALLATION_ID_STORAGE_KEY);
  if (existing && existing.trim().length > 0) {
    return existing;
  }

  const nextId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : encodeBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  safeLocalStorageSet(PUSH_INSTALLATION_ID_STORAGE_KEY, nextId);
  return nextId;
}

interface StoredPushRegistration {
  /** Web Push endpoint or native FCM token, depending on the store. */
  readonly id: string | null;
  readonly pubkey: string | null;
}

const makePushRegistrationStore = (idKey: string, pubkeyKey: string) => ({
  read: (): StoredPushRegistration => ({
    id: safeLocalStorageGet(idKey),
    pubkey: safeLocalStorageGet(pubkeyKey),
  }),
  write: (id: string, pubkey: string): void => {
    safeLocalStorageSet(idKey, id);
    safeLocalStorageSet(pubkeyKey, pubkey);
  },
  clear: (): void => {
    safeLocalStorageRemove(idKey);
    safeLocalStorageRemove(pubkeyKey);
  },
});

const pwaRegistrationStore = makePushRegistrationStore(
  REGISTERED_PUSH_ENDPOINT_STORAGE_KEY,
  REGISTERED_PUSH_PUBKEY_STORAGE_KEY,
);
const nativeRegistrationStore = makePushRegistrationStore(
  REGISTERED_NATIVE_PUSH_TOKEN_STORAGE_KEY,
  REGISTERED_NATIVE_PUSH_PUBKEY_STORAGE_KEY,
);

export function arePushNotificationsDisabledByUser(): boolean {
  return safeLocalStorageGet(PUSH_NOTIFICATIONS_DISABLED_STORAGE_KEY) === "1";
}

export function setPushNotificationsDisabledByUser(disabled: boolean): void {
  if (disabled) {
    safeLocalStorageSet(PUSH_NOTIFICATIONS_DISABLED_STORAGE_KEY, "1");
    return;
  }

  safeLocalStorageRemove(PUSH_NOTIFICATIONS_DISABLED_STORAGE_KEY);
}

export async function hasNativePushRegistrationForIdentity(
  currentNsec: string,
): Promise<boolean> {
  if (!isNativePlatform()) {
    return false;
  }

  const stored = nativeRegistrationStore.read();
  if (!stored.id || !stored.pubkey) {
    return false;
  }

  try {
    return stored.pubkey === derivePushIdentity(currentNsec).pubkey;
  } catch {
    return false;
  }
}

type PushSubscriptionData = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

const ChallengeResponse = Schema.Struct({
  action: Schema.Literal("subscribe", "unsubscribe"),
  challenge: NonBlankString,
  expiresAt: Schema.Finite,
  pubkey: NonBlankString,
});
type ChallengeResponse = typeof ChallengeResponse.Type;
const decodeChallengeResponse = Schema.decodeUnknownSync(ChallengeResponse);
const decodeVapidPublicKeyResponse = Schema.decodeUnknownOption(
  Schema.Struct({ vapidPublicKey: Schema.String }),
);

type OwnershipProof = {
  event: SignedPlainEvent;
  pubkey: string;
};

function describeSubscription(subscription: PushSubscription | null): {
  applicationServerKey: string | null;
  endpointHash: string | null;
  expirationTime: number | null;
  hasAuth: boolean;
  hasApplicationServerKey: boolean;
  hasP256dh: boolean;
} {
  const endpoint = subscription?.endpoint ?? "";
  const applicationServerKey =
    subscription === null ? null : readApplicationServerKey(subscription);
  return {
    applicationServerKey,
    endpointHash: endpoint ? endpoint.slice(-24) : null,
    expirationTime: subscription?.expirationTime ?? null,
    hasAuth: Boolean(subscription?.getKey("auth")),
    hasApplicationServerKey: applicationServerKey !== null,
    hasP256dh: Boolean(subscription?.getKey("p256dh")),
  };
}

function hashStoredIdentifier(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  return value.slice(-24);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function encodeKey(value: ArrayBuffer | null): string {
  return value ? base64.encode(new Uint8Array(value)) : "";
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.trim() || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function derivePushIdentity(currentNsec: string): {
  pubkey: string;
  secretKey: NostrSecretKey;
} {
  const identity = identityFromNsec(currentNsec);
  if (!identity) throw new Error("Invalid nsec");
  return identity;
}

async function requestChallenge(
  pubkey: string,
  action: "subscribe" | "unsubscribe",
): Promise<ChallengeResponse> {
  const response = await fetch(`${PUSH_SERVER_URL}/auth/challenge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action,
      pubkey,
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return decodeChallengeResponse(await response.json());
}

async function unregisterOnServer(
  currentNsec: string,
  path: "/unsubscribe" | "/native/unsubscribe",
  target: { endpoint: string } | { token: string },
): Promise<boolean> {
  const { pubkey } = derivePushIdentity(currentNsec);
  const challenge = await requestChallenge(pubkey, "unsubscribe");
  const proof = await createOwnershipProof({
    action: "unsubscribe",
    challenge: challenge.challenge,
    currentNsec,
  });
  const response = await fetch(`${PUSH_SERVER_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...target,
      recipientPubkeys: [pubkey],
      proofs: [proof],
    }),
  });

  return response.ok;
}

async function cleanupStaleRegistration(args: {
  details: Record<string, unknown>;
  logPrefix: string;
  unregister: () => Promise<boolean>;
}): Promise<void> {
  try {
    const removed = await args.unregister();
    appendPushDebugLog("client", `${args.logPrefix} result`, {
      ...args.details,
      removed,
    });
  } catch (error) {
    appendPushDebugLog("client", `${args.logPrefix} failed`, {
      ...args.details,
      error,
    });
  }
}

async function createOwnershipProof(params: {
  action: "subscribe" | "unsubscribe";
  challenge: string;
  currentNsec: string;
}): Promise<OwnershipProof> {
  const { secretKey, pubkey } = derivePushIdentity(params.currentNsec);

  return {
    event: makePushOwnershipProof(
      { action: params.action, challenge: params.challenge },
      secretKey,
      UnixSeconds.make(nowSeconds()),
    ),
    pubkey,
  };
}

function readApplicationServerKey(
  subscription: PushSubscription,
): string | null {
  const applicationServerKey = subscription.options.applicationServerKey;
  if (applicationServerKey === null) {
    return null;
  }

  return encodeBase64Url(new Uint8Array(applicationServerKey));
}

function toPushSubscriptionData(
  subscription: PushSubscription,
): PushSubscriptionData {
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: {
      p256dh: encodeKey(subscription.getKey("p256dh")),
      auth: encodeKey(subscription.getKey("auth")),
    },
  };
}

async function ensureNativePushListeners(): Promise<void> {
  if (!isNativePlatform()) {
    return;
  }

  if (nativePushListenersPromise) {
    return nativePushListenersPromise;
  }

  nativePushListenersPromise = (async () => {
    await PushNotifications.addListener("registration", (token: Token) => {
      const normalized = token.value.trim();
      appendPushDebugLog("client", "native push token event", {
        tokenHash: hashStoredIdentifier(normalized),
      });

      if (!normalized) {
        const error = new Error("Native push token is empty");
        for (const waiter of pendingNativePushTokenWaiters) {
          waiter.reject(error);
        }
        pendingNativePushTokenWaiters.clear();
        return;
      }

      for (const waiter of pendingNativePushTokenWaiters) {
        waiter.resolve(normalized);
      }
      pendingNativePushTokenWaiters.clear();
    });

    await PushNotifications.addListener("registrationError", (error) => {
      const wrappedError = new Error(error.error);
      appendPushDebugLog("client", "native push token error", {
        error,
      });
      for (const waiter of pendingNativePushTokenWaiters) {
        waiter.reject(wrappedError);
      }
      pendingNativePushTokenWaiters.clear();
    });

    await PushNotifications.addListener(
      "pushNotificationReceived",
      (notification: PushNotificationSchema) => {
        appendPushDebugLog(
          "client",
          "native push notification received",
          notification,
        );
        window.dispatchEvent(
          new CustomEvent("linky-native-push-received", {
            detail: notification,
          }),
        );
      },
    );

    await PushNotifications.addListener(
      "pushNotificationActionPerformed",
      (notification: PushNotificationActionPerformed) => {
        appendPushDebugLog(
          "client",
          "native push notification action",
          notification,
        );
        window.dispatchEvent(
          new CustomEvent(NATIVE_PUSH_ACTION_EVENT, {
            detail: notification,
          }),
        );
      },
    );
  })();

  return nativePushListenersPromise;
}

function waitForNativePushToken(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const waiter = { reject, resolve };
    pendingNativePushTokenWaiters.add(waiter);

    window.setTimeout(() => {
      if (!pendingNativePushTokenWaiters.has(waiter)) {
        return;
      }
      pendingNativePushTokenWaiters.delete(waiter);
      reject(new Error("Timed out while waiting for native push token"));
    }, 15000);
  });
}

async function requestNativePushToken(): Promise<string> {
  await ensureNativePushListeners();
  const tokenPromise = waitForNativePushToken();
  await PushNotifications.register();
  return tokenPromise;
}

async function registerNativePushNotifications(
  currentNsec: string,
): Promise<{ success: boolean; error?: string }> {
  const permissionState = getNativeNotificationPermissionState();
  if (permissionState === null || permissionState === "unsupported") {
    appendPushDebugLog("client", "native push unsupported", {
      permissionState,
    });
    return {
      success: false,
      error:
        "Native push není v tomto buildu nakonfigurovaný. V Android shellu chybí google-services.json.",
    };
  }

  const granted = await requestNotificationPermission();
  appendPushDebugLog("client", "native push registration requested", {
    granted,
    permissionState,
  });

  if (!granted) {
    return { success: false, error: "Nativni notifikace nejsou povolene" };
  }

  try {
    const installationId = getOrCreatePushInstallationId();
    const { pubkey } = derivePushIdentity(currentNsec);
    const { id: previousToken, pubkey: storedPubkey } =
      nativeRegistrationStore.read();
    const token = await requestNativePushToken();

    const challenge = await requestChallenge(pubkey, "subscribe");
    const proof = await createOwnershipProof({
      action: "subscribe",
      challenge: challenge.challenge,
      currentNsec,
    });

    const response = await fetch(`${PUSH_SERVER_URL}/native/subscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cleanupLegacySubscriptions: true,
        installationId,
        proofs: [proof],
        recipientPubkeys: [pubkey],
        device: { platform: "android", token },
      }),
    });

    if (!response.ok) {
      const errorMessage = await readErrorMessage(response);
      appendPushDebugLog("client", "native push register server error", {
        errorMessage,
        installationId,
        pubkey,
        status: response.status,
        tokenHash: hashStoredIdentifier(token),
      });
      return {
        success: false,
        error: `Server vrátil chybu ${response.status}: ${errorMessage}`,
      };
    }

    const shouldCleanupPreviousToken =
      previousToken !== null &&
      previousToken !== token &&
      (storedPubkey === null || storedPubkey === pubkey);
    if (shouldCleanupPreviousToken) {
      await cleanupStaleRegistration({
        details: {
          installationId,
          previousTokenHash: hashStoredIdentifier(previousToken),
          pubkey,
          tokenHash: hashStoredIdentifier(token),
        },
        logPrefix: "native push stale token cleanup",
        unregister: () =>
          unregisterOnServer(currentNsec, "/native/unsubscribe", {
            token: previousToken,
          }),
      });
    }

    nativeRegistrationStore.write(token, pubkey);

    appendPushDebugLog("client", "native push register success", {
      installationId,
      previousTokenHash: hashStoredIdentifier(previousToken),
      pubkey,
      tokenHash: hashStoredIdentifier(token),
    });
    return { success: true };
  } catch (error) {
    appendPushDebugLog("client", "native push register exception", {
      error,
    });
    return { success: false, error: `Chyba: ${String(error ?? "")}` };
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (isNativePlatform()) {
    const granted = await requestNativeNotificationPermission();
    appendPushDebugLog("client", "native notification permission result", {
      granted,
      permissionState: getNativeNotificationPermissionState(),
    });
    return granted === true;
  }

  if (!("Notification" in window)) {
    appendPushDebugLog("client", "notification permission unsupported");
    return false;
  }

  const permission = await Notification.requestPermission();
  appendPushDebugLog("client", "notification permission result", {
    permission,
  });
  return permission === "granted";
}

export async function registerPushNotifications(
  currentNsec: string,
): Promise<{ success: boolean; error?: string }> {
  if (isNativePlatform()) {
    return registerNativePushNotifications(currentNsec);
  }

  try {
    appendPushDebugLog("client", "push register start", {
      permission:
        "Notification" in window ? Notification.permission : "missing",
    });

    if (!("serviceWorker" in navigator)) {
      appendPushDebugLog("client", "push register failed", {
        reason: "service_worker_unsupported",
      });
      return { success: false, error: "Service Worker není podporován" };
    }

    let vapidPublicKey: string;
    try {
      vapidPublicKey = await fetchVapidPublicKey();
    } catch (fetchError) {
      appendPushDebugLog("client", "push register failed", {
        reason: "vapid_key_fetch_failed",
        error: fetchError,
      });
      return {
        success: false,
        error: `Nepodařilo se získat VAPID klíč: ${String(fetchError ?? "")}`,
      };
    }

    const storedKey = safeLocalStorageGet(VAPID_KEY_STORAGE_KEY);
    const vapidKeyChanged = storedKey !== null && storedKey !== vapidPublicKey;
    const installationId = getOrCreatePushInstallationId();

    const { pubkey } = derivePushIdentity(currentNsec);
    const { id: storedEndpoint, pubkey: storedPubkey } =
      pwaRegistrationStore.read();
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    let replacedEndpoint: string | null = null;
    const subscriptionApplicationServerKey =
      subscription === null ? null : readApplicationServerKey(subscription);
    const subscriptionUsesCurrentVapidKey =
      subscription === null
        ? false
        : subscriptionApplicationServerKey === vapidPublicKey;
    appendPushDebugLog("client", "push registration ready", {
      hasActiveWorker: Boolean(registration.active),
      installationId,
      pubkey,
      storedEndpointHash:
        storedEndpoint === null ? null : storedEndpoint.slice(-24),
      storedPubkey,
      subscription: describeSubscription(subscription),
      storedVapidKey: storedKey,
      subscriptionApplicationServerKey,
      vapidKeyChanged,
      subscriptionUsesCurrentVapidKey,
    });

    if (subscription && !subscriptionUsesCurrentVapidKey) {
      replacedEndpoint = subscription.endpoint;
      appendPushDebugLog(
        "client",
        "push subscription vapid mismatch, re-subscribing",
        {
          replacedEndpointHash: replacedEndpoint.slice(-24),
          storedVapidKey: storedKey,
          subscriptionApplicationServerKey,
          vapidKeyChanged,
        },
      );
      await subscription.unsubscribe().catch(() => false);
      subscription = null;
    }

    const previousEndpoint = replacedEndpoint ?? storedEndpoint;

    if (!subscription) {
      try {
        const applicationServerKey = decodeBase64Url(vapidPublicKey);
        if (!applicationServerKey) {
          throw new Error("Invalid VAPID public key");
        }
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: toArrayBuffer(applicationServerKey),
        });
        safeLocalStorageSet(VAPID_KEY_STORAGE_KEY, vapidPublicKey);
        appendPushDebugLog("client", "push subscribe created", {
          subscription: describeSubscription(subscription),
        });
      } catch (subError) {
        appendPushDebugLog("client", "push subscribe failed", {
          error: subError,
        });
        return {
          success: false,
          error: `Chyba při vytváření subscription: ${String(subError ?? "")}`,
        };
      }
    } else {
      safeLocalStorageSet(VAPID_KEY_STORAGE_KEY, vapidPublicKey);
    }

    const challenge = await requestChallenge(pubkey, "subscribe");
    appendPushDebugLog("client", "push challenge received", {
      action: challenge.action,
      expiresAt: challenge.expiresAt,
      pubkey: challenge.pubkey,
    });
    const proof = await createOwnershipProof({
      action: "subscribe",
      challenge: challenge.challenge,
      currentNsec,
    });

    const response = await fetch(`${PUSH_SERVER_URL}/subscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cleanupLegacySubscriptions: true,
        installationId,
        proofs: [proof],
        recipientPubkeys: [pubkey],
        subscription: toPushSubscriptionData(subscription),
      }),
    });

    if (!response.ok) {
      const errorMessage = await readErrorMessage(response);
      appendPushDebugLog("client", "push register server error", {
        errorMessage,
        pubkey,
        status: response.status,
        subscription: describeSubscription(subscription),
      });
      return {
        success: false,
        error: `Server vrátil chybu ${response.status}: ${errorMessage}`,
      };
    }

    const currentEndpoint = subscription.endpoint;
    const shouldCleanupPreviousEndpoint =
      previousEndpoint !== null &&
      previousEndpoint !== currentEndpoint &&
      (storedPubkey === null ||
        storedPubkey === pubkey ||
        replacedEndpoint !== null);
    if (shouldCleanupPreviousEndpoint) {
      await cleanupStaleRegistration({
        details: {
          currentEndpointHash: currentEndpoint.slice(-24),
          installationId,
          previousEndpointHash: previousEndpoint.slice(-24),
          pubkey,
          replacedEndpointHash:
            replacedEndpoint === null ? null : replacedEndpoint.slice(-24),
          storedPubkey,
        },
        logPrefix: "push stale endpoint cleanup",
        unregister: () =>
          unregisterOnServer(currentNsec, "/unsubscribe", {
            endpoint: previousEndpoint,
          }),
      });
    }

    pwaRegistrationStore.write(currentEndpoint, pubkey);

    appendPushDebugLog("client", "push register success", {
      currentEndpointHash: currentEndpoint.slice(-24),
      installationId,
      previousEndpointHash:
        previousEndpoint === null ? null : previousEndpoint.slice(-24),
      pubkey,
      subscription: describeSubscription(subscription),
    });
    return { success: true };
  } catch (error) {
    appendPushDebugLog("client", "push register exception", { error });
    return { success: false, error: `Chyba: ${String(error ?? "")}` };
  }
}

export async function unregisterPushNotifications(
  currentNsec: string,
): Promise<boolean> {
  setPushNotificationsDisabledByUser(true);

  if (isNativePlatform()) {
    try {
      const storedToken = nativeRegistrationStore.read().id;
      const responseOk =
        storedToken === null
          ? false
          : await unregisterOnServer(currentNsec, "/native/unsubscribe", {
              token: storedToken,
            }).catch(() => false);
      const unregistered = await PushNotifications.unregister()
        .then(() => true)
        .catch(() => false);
      if (responseOk || unregistered) {
        nativeRegistrationStore.clear();
      }
      appendPushDebugLog("client", "native push unregister result", {
        responseOk,
        tokenHash: hashStoredIdentifier(storedToken),
        unregistered,
      });
      return responseOk || unregistered;
    } catch (error) {
      appendPushDebugLog("client", "native push unregister exception", {
        error,
      });
      return false;
    }
  }

  try {
    if (!("serviceWorker" in navigator)) {
      pwaRegistrationStore.clear();
      appendPushDebugLog("client", "push unregister failed", {
        reason: "service_worker_unsupported",
      });
      return true;
    }

    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = registration
      ? await registration.pushManager.getSubscription()
      : null;
    const storedEndpoint = pwaRegistrationStore.read().id;

    if (!subscription) {
      const responseOk = storedEndpoint
        ? await unregisterOnServer(currentNsec, "/unsubscribe", {
            endpoint: storedEndpoint,
          }).catch(() => false)
        : false;
      pwaRegistrationStore.clear();
      if (storedEndpoint) {
        appendPushDebugLog("client", "push unregister stale endpoint", {
          responseOk,
          storedEndpointHash: storedEndpoint.slice(-24),
        });
      }
      appendPushDebugLog("client", "push unregister noop", {
        reason: "missing_subscription",
        storedEndpointHash:
          storedEndpoint === null ? null : storedEndpoint.slice(-24),
      });
      return true;
    }

    const responseOk = await unregisterOnServer(currentNsec, "/unsubscribe", {
      endpoint: subscription.endpoint,
    }).catch(() => false);
    const unsubscribed = await subscription.unsubscribe().catch(() => false);
    const isDisabled = responseOk || unsubscribed;
    if (isDisabled) {
      pwaRegistrationStore.clear();
    }
    appendPushDebugLog("client", "push unregister result", {
      ok: isDisabled,
      responseOk,
      storedEndpointHash:
        storedEndpoint === null ? null : storedEndpoint.slice(-24),
      subscription: describeSubscription(subscription),
      unsubscribed,
    });
    return isDisabled;
  } catch (error) {
    appendPushDebugLog("client", "push unregister exception", { error });
    return false;
  }
}
