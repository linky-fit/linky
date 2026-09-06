import { cert, getApps, initializeApp } from "firebase-admin/app";
import {
  getMessaging,
  type Message,
  type Messaging,
} from "firebase-admin/messaging";
import { createHash } from "node:crypto";
import * as webpush from "web-push";

import { isRecord } from "./guards";
import { hashSecret } from "./hashSecret";
import { PushStorage } from "./storage";
import type {
  PushNotificationData,
  PushNotificationEnvelope,
  StoredNativeSubscription,
  StoredSubscription,
  WebPushSubscriptionData,
} from "./types";

interface PushDeliveryServiceOptions {
  firebaseServiceAccountJson: string | null;
  vapidSubject: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  storage: PushStorage;
}

const DELIVERY_TTL_SECONDS = 24 * 60 * 60;
const NOTIFICATION_BODY = "Nová aktivita v Linky";

function formatShortNpub(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 18) return trimmed;
  return `${trimmed.slice(0, 10)}...${trimmed.slice(-6)}`;
}

function buildNotificationTitle(payloadData: PushNotificationData): string {
  const recipientLabel = formatShortNpub(
    payloadData.recipientNpub || payloadData.recipientPubkey,
  );
  return recipientLabel ? `Linky - ${recipientLabel}` : "Linky";
}

function isVapidKeyMismatchBody(errorBody: string | null): boolean {
  if (errorBody === null) {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(errorBody);
  } catch {
    return false;
  }

  if (!isRecord(parsed)) {
    return false;
  }

  const message = parsed.message;
  if (message === "VAPID public key mismatch") {
    return true;
  }

  const reason = parsed.reason;
  return reason === "VapidPkHashMismatch";
}

function isPermanentPushFailure(
  statusCode: number | null,
  errorBody: string | null,
): boolean {
  if (statusCode === 404 || statusCode === 410) {
    return true;
  }

  return (
    (statusCode === 400 || statusCode === 401) &&
    isVapidKeyMismatchBody(errorBody)
  );
}

function describePermanentPushFailure(
  statusCode: number | null,
  errorBody: string | null,
): string | null {
  if (statusCode === 404) {
    return "not_found";
  }

  if (statusCode === 410) {
    return "gone";
  }

  if (
    (statusCode === 400 || statusCode === 401) &&
    isVapidKeyMismatchBody(errorBody)
  ) {
    return "vapid_key_mismatch";
  }

  return null;
}

function toWebPushSubscription(
  subscription: StoredSubscription,
): WebPushSubscriptionData {
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
  };
}

function buildPushTopic(payloadData: PushNotificationData): string {
  return createHash("sha256")
    .update(`${payloadData.outerEventId}:${payloadData.recipientPubkey}`)
    .digest("base64url")
    .slice(0, 32);
}

function readErrorStatusCode(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }
  const statusCode = error.statusCode;
  return typeof statusCode === "number" && Number.isFinite(statusCode)
    ? statusCode
    : null;
}

function readErrorBody(error: unknown): string | null {
  if (!isRecord(error)) {
    return null;
  }
  const body = error.body;
  return typeof body === "string" && body.trim().length > 0 ? body : null;
}

export class PushDeliveryService {
  readonly nativeDeliveryEnabled: boolean;
  private readonly storage: PushStorage;
  private readonly messaging: Messaging | null;

  constructor(options: PushDeliveryServiceOptions) {
    this.storage = options.storage;
    webpush.setVapidDetails(
      options.vapidSubject,
      options.vapidPublicKey,
      options.vapidPrivateKey,
    );
    this.messaging = createFirebaseMessaging(
      options.firebaseServiceAccountJson,
    );
    this.nativeDeliveryEnabled = this.messaging !== null;
  }

  async deliverWeb(
    subscription: StoredSubscription,
    payloadData: PushNotificationData,
  ): Promise<void> {
    const endpointHash = hashSecret(subscription.endpoint);
    const payload: PushNotificationEnvelope = {
      title: buildNotificationTitle(payloadData),
      body: NOTIFICATION_BODY,
      data: payloadData,
    };

    try {
      await webpush.sendNotification(
        toWebPushSubscription(subscription),
        JSON.stringify(payload),
        {
          TTL: DELIVERY_TTL_SECONDS,
          urgency: "normal",
          topic: buildPushTopic(payloadData),
        },
      );
      console.info(
        `[push] sent notification successfully id=${subscription.id} outerEventId=${payloadData.outerEventId} recipient=${payloadData.recipientPubkey} endpoint=${endpointHash} ttl=${DELIVERY_TTL_SECONDS}`,
      );
    } catch (error) {
      const statusCode = readErrorStatusCode(error);
      const errorBody = readErrorBody(error);
      const permanentFailureReason = describePermanentPushFailure(
        statusCode,
        errorBody,
      );
      if (isPermanentPushFailure(statusCode, errorBody)) {
        this.storage.removeSubscriptionById(subscription.id);
        console.warn(
          `[push] removed subscription from db id=${subscription.id} endpoint=${endpointHash} status=${statusCode ?? "unknown"} reason=${permanentFailureReason ?? "unknown"}`,
        );
      }
      console.warn(
        `[push] delivery failed ${payloadData.outerEventId} to ${payloadData.recipientPubkey} endpoint=${endpointHash} status=${statusCode ?? "unknown"} body=${errorBody ?? "n/a"}`,
      );
      throw error;
    }
  }

  async deliverNative(
    subscription: StoredNativeSubscription,
    payloadData: PushNotificationData,
  ): Promise<void> {
    if (this.messaging === null) {
      throw new Error("Native push delivery is not configured");
    }

    const tokenHash = hashSecret(subscription.token);
    const message: Message = {
      token: subscription.token,
      data: {
        body: NOTIFICATION_BODY,
        createdAt: String(payloadData.createdAt),
        outerEventId: payloadData.outerEventId,
        recipientNpub: payloadData.recipientNpub,
        recipientPubkey: payloadData.recipientPubkey,
        relayHints: JSON.stringify(payloadData.relayHints),
        title: buildNotificationTitle(payloadData),
        type: payloadData.type,
      },
      android: {
        priority: "high",
      },
    };

    try {
      const messageId = await this.messaging.send(message, false);
      console.info(
        `[push] sent native notification successfully id=${subscription.id} outerEventId=${payloadData.outerEventId} recipient=${payloadData.recipientPubkey} token=${tokenHash} messageId=${messageId}`,
      );
    } catch (error) {
      const code = readFirebaseErrorCode(error);
      if (isPermanentFirebaseFailure(code)) {
        this.storage.removeNativeSubscriptionById(subscription.id);
        console.warn(
          `[push] removed native subscription from db id=${subscription.id} token=${tokenHash} code=${code ?? "unknown"}`,
        );
      }
      console.warn(
        `[push] native delivery failed ${payloadData.outerEventId} to ${payloadData.recipientPubkey} token=${tokenHash} code=${code ?? "unknown"}`,
        error,
      );
      throw error;
    }
  }
}

function createFirebaseMessaging(
  firebaseServiceAccountJson: string | null,
): Messaging | null {
  if (firebaseServiceAccountJson === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(firebaseServiceAccountJson);
  } catch (error) {
    console.error("[push] invalid PUSH_FIREBASE_SERVICE_ACCOUNT_JSON", error);
    return null;
  }

  if (!isRecord(parsed)) {
    console.error(
      "[push] PUSH_FIREBASE_SERVICE_ACCOUNT_JSON must parse to an object",
    );
    return null;
  }

  const projectId = parsed.project_id;
  const clientEmail = parsed.client_email;
  const privateKey = parsed.private_key;
  if (
    typeof projectId !== "string" ||
    typeof clientEmail !== "string" ||
    typeof privateKey !== "string"
  ) {
    console.error(
      "[push] PUSH_FIREBASE_SERVICE_ACCOUNT_JSON is missing project_id, client_email or private_key",
    );
    return null;
  }

  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      projectId,
    });
  return getMessaging(app);
}

function readFirebaseErrorCode(error: unknown): string | null {
  if (!isRecord(error)) {
    return null;
  }
  const code = error.code;
  return typeof code === "string" && code.trim().length > 0 ? code : null;
}

function isPermanentFirebaseFailure(code: string | null): boolean {
  return (
    code === "messaging/invalid-registration-token" ||
    code === "messaging/registration-token-not-registered"
  );
}
