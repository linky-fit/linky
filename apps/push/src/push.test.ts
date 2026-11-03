import { describe, expect, it, spyOn } from "bun:test";
import { createECDH, generateKeyPairSync, randomBytes } from "node:crypto";
import * as firebaseMessaging from "firebase-admin/messaging";
import * as webpush from "web-push";

import { PushDeliveryService } from "./push";
import { PushStorage } from "./storage";
import {
  createStoragePath,
  readPushStats,
  removeStoragePath,
} from "./testSupport";
import type {
  PushNotificationData,
  StoredNativeSubscription,
  StoredSubscription,
} from "./types";
import * as transport from "./webPushTransport";

const vapidKeys = webpush.generateVAPIDKeys();
const firebaseServiceAccountJson = JSON.stringify({
  project_id: "linky-test",
  client_email: "push@linky-test.iam.gserviceaccount.com",
  private_key: generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString(),
});
const payloadData: PushNotificationData = {
  type: "nostr_inbox",
  outerEventId: "e".repeat(64),
  recipientPubkey: "a".repeat(64),
  recipientNpub: "npub1test",
  createdAt: 1_700_000_000,
};
const nativeSubscription: StoredNativeSubscription = {
  id: 1,
  platform: "android",
  token: "fcm-token",
};

function webSubscription(): StoredSubscription {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    id: 1,
    endpoint: "https://push.example.test/send",
    expirationTime: null,
    keys: {
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
}

async function withService(
  run: (service: PushDeliveryService, storagePath: string) => Promise<void>,
): Promise<void> {
  const storagePath = createStoragePath("linky-push-delivery-");
  const storage = new PushStorage(storagePath);
  const service = new PushDeliveryService({
    firebaseServiceAccountJson,
    vapidSubject: "mailto:test@example.test",
    vapidPublicKey: vapidKeys.publicKey,
    vapidPrivateKey: vapidKeys.privateKey,
    storage,
  });
  try {
    await run(service, storagePath);
  } finally {
    storage.close();
    removeStoragePath(storagePath);
  }
}

describe("PushDeliveryService delivery counts", () => {
  it("counts web deliveries the provider accepts and refuses", async () => {
    const send = spyOn(transport, "sendWebPushRequest");
    await withService(async (service, storagePath) => {
      send.mockResolvedValueOnce();
      await service.deliverWeb(webSubscription(), payloadData);

      send.mockRejectedValueOnce(
        new transport.PushResponseError(500, "unavailable"),
      );
      await expect(
        service.deliverWeb(webSubscription(), payloadData),
      ).rejects.toThrow("HTTP 500");

      expect(readPushStats(storagePath)).toEqual({ sent: 1, failed: 1 });
    }).finally(() => send.mockRestore());
  });

  it("counts native deliveries FCM accepts and refuses", async () => {
    const send = spyOn(firebaseMessaging.Messaging.prototype, "send");
    await withService(async (service, storagePath) => {
      send.mockResolvedValueOnce("message-id");
      await service.deliverNative(nativeSubscription, payloadData);

      send.mockRejectedValueOnce(new Error("unavailable"));
      await expect(
        service.deliverNative(nativeSubscription, payloadData),
      ).rejects.toThrow("unavailable");

      expect(readPushStats(storagePath)).toEqual({ sent: 1, failed: 1 });
    }).finally(() => send.mockRestore());
  });
});
