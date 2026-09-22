import { derivePubkey, NostrSecretKey } from "@linky/linkstr";
import { describe, expect, it } from "bun:test";

import { ReminderDispatcher } from "./reminderDispatcher";
import { PushStorage } from "./storage";
import { createStoragePath, removeStoragePath } from "./testSupport";
import type {
  PushNotificationData,
  StoredNativeSubscription,
  StoredSubscription,
} from "./types";

const recipient = derivePubkey(NostrSecretKey.make(new Uint8Array(32).fill(3)));
const silent = derivePubkey(NostrSecretKey.make(new Uint8Array(32).fill(4)));
const nowMs = 1_800_000_000_000;
const nowSec = nowMs / 1000;

class RecordingPushDelivery {
  readonly web: PushNotificationData[] = [];
  readonly native: PushNotificationData[] = [];
  deliverWeb(
    _subscription: StoredSubscription,
    payloadData: PushNotificationData,
  ): Promise<void> {
    this.web.push(payloadData);
    return Promise.resolve();
  }
  deliverNative(
    _subscription: StoredNativeSubscription,
    payloadData: PushNotificationData,
  ): Promise<void> {
    this.native.push(payloadData);
    return Promise.reject(new Error("fcm down"));
  }
}

async function withHarness(
  run: (harness: {
    storage: PushStorage;
    delivery: RecordingPushDelivery;
    dispatcher: ReminderDispatcher;
  }) => Promise<void>,
): Promise<void> {
  const storagePath = createStoragePath("linky-reminders-");
  const storage = new PushStorage(storagePath);
  const delivery = new RecordingPushDelivery();
  const dispatcher = new ReminderDispatcher({
    storage,
    pushDelivery: delivery,
  });
  try {
    await run({ storage, delivery, dispatcher });
  } finally {
    storage.close();
    removeStoragePath(storagePath);
  }
}

const subscriptionDefaults = {
  cleanupLegacySubscriptions: false,
  installationId: null,
  consumedChallengeNonces: [],
  maxPubkeysPerSubscription: 8,
  maxSubscriptionsPerPubkey: 16,
  nowMs,
};

describe("ReminderDispatcher", () => {
  it("sends a reminder to every device of the pubkey once it is due, then forgets it", async () => {
    await withHarness(async ({ storage, delivery, dispatcher }) => {
      storage.registerSubscription({
        ...subscriptionDefaults,
        subscription: {
          endpoint: "https://example.com/push",
          expirationTime: null,
          keys: { p256dh: "p", auth: "a" },
        },
        recipientPubkeys: [recipient],
      });
      storage.registerNativeSubscription({
        ...subscriptionDefaults,
        device: { platform: "android", token: "token" },
        recipientPubkeys: [recipient],
      });
      storage.replaceReminders({
        consumedChallengeNonces: [],
        maxRemindersPerPubkey: 32,
        nowMs,
        pubkey: recipient,
        notifyAtSecs: [nowSec + 60],
      });

      expect(await dispatcher.dispatch(nowMs)).toBe(0);
      expect(delivery.web).toEqual([]);

      expect(await dispatcher.dispatch(nowMs + 60_000)).toBe(1);
      const expected: PushNotificationData = {
        type: "recurring_reminder",
        recipientPubkey: recipient,
        recipientNpub: expect.stringMatching(/^npub1/),
        notifyAtSec: nowSec + 60,
      };
      expect(delivery.web).toEqual([expected]);
      // A failing native delivery does not stop the web one or the pass.
      expect(delivery.native).toEqual([expected]);

      expect(await dispatcher.dispatch(nowMs + 120_000)).toBe(0);
      expect(delivery.web).toHaveLength(1);
    });
  });

  it("skips a pubkey with no registered device", async () => {
    await withHarness(async ({ storage, delivery, dispatcher }) => {
      storage.replaceReminders({
        consumedChallengeNonces: [],
        maxRemindersPerPubkey: 32,
        nowMs,
        pubkey: silent,
        notifyAtSecs: [nowSec + 1],
      });
      expect(await dispatcher.dispatch(nowMs + 5_000)).toBe(0);
      expect(delivery.web).toEqual([]);
      expect(storage.getReminders(silent)).toEqual([]);
    });
  });
});
