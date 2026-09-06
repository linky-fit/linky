import {
  derivePubkey,
  NostrSecretKey,
  WrapId,
  type DeliveredPushWrap,
  type InboxDelivery,
} from "@linky/linkstr";
import { describe, expect, it, setSystemTime } from "bun:test";
import { Database } from "bun:sqlite";

import {
  CATCH_UP_LOOKBACK_SECONDS,
  SEEN_EVENT_RETENTION_MARGIN_MS,
} from "./config";
import { RelayWatcher } from "./relayWatcher";
import { PushStorage } from "./storage";
import { createStoragePath, removeStoragePath } from "./testSupport";
import type {
  PushNotificationData,
  StoredNativeSubscription,
  StoredSubscription,
} from "./types";

const recipient = derivePubkey(NostrSecretKey.make(new Uint8Array(32).fill(1)));
const retentionMs =
  CATCH_UP_LOOKBACK_SECONDS * 1000 + SEEN_EVENT_RETENTION_MARGIN_MS;

interface DeliveryRecord<T> {
  subscription: T;
  payloadData: PushNotificationData;
}

class RecordingPushDelivery {
  readonly webDeliveries: Array<DeliveryRecord<StoredSubscription>> = [];
  readonly nativeDeliveries: Array<DeliveryRecord<StoredNativeSubscription>> =
    [];

  deliverWeb(
    subscription: StoredSubscription,
    payloadData: PushNotificationData,
  ): Promise<void> {
    this.webDeliveries.push({ subscription, payloadData });
    return Promise.resolve();
  }

  deliverNative(
    subscription: StoredNativeSubscription,
    payloadData: PushNotificationData,
  ): Promise<void> {
    this.nativeDeliveries.push({ subscription, payloadData });
    return Promise.resolve();
  }
}

interface WatcherHarness {
  storagePath: string;
  storage: PushStorage;
  pushDelivery: RecordingPushDelivery;
  watcher: RelayWatcher;
}

function createHarness(): WatcherHarness {
  const storagePath = createStoragePath("linky-relay-watcher-");
  const storage = new PushStorage(storagePath);
  const pushDelivery = new RecordingPushDelivery();
  const watcher = new RelayWatcher({
    relayUrls: [],
    storage,
    pushDelivery,
  });
  return { storagePath, storage, pushDelivery, watcher };
}

async function withHarness(
  run: (harness: WatcherHarness) => Promise<void>,
): Promise<void> {
  const harness = createHarness();
  try {
    await run(harness);
  } finally {
    harness.storage.close();
    removeStoragePath(harness.storagePath);
  }
}

function registerWebSubscription(storage: PushStorage): void {
  storage.registerSubscription({
    cleanupLegacySubscriptions: false,
    installationId: null,
    subscription: {
      endpoint: "https://example.com/push",
      expirationTime: null,
      keys: {
        p256dh: "p256dh",
        auth: "auth",
      },
    },
    recipientPubkeys: [recipient],
    consumedChallengeNonces: [],
    maxPubkeysPerSubscription: 1,
    maxSubscriptionsPerPubkey: 1,
    nowMs: 1,
  });
}

function deliveredWrap(
  id: number,
  delivery: InboxDelivery = "live",
): DeliveredPushWrap {
  return {
    delivery,
    wrap: {
      wrapId: WrapId.make(id.toString(16).padStart(64, "0")),
      recipient,
      createdAt: 1_754_000_000,
      relayHints: ["wss://hint.test"],
    },
  };
}

function hasSeenEvent(storagePath: string, eventId: string): boolean {
  const db = new Database(storagePath);
  try {
    return (
      db
        .query("SELECT event_id FROM seen_events WHERE event_id = ?")
        .get(eventId) !== null
    );
  } finally {
    db.close();
  }
}

describe("RelayWatcher", () => {
  it("delivers a live wrap and records it in the seen ledger", async () => {
    await withHarness(
      async ({ storage, storagePath, pushDelivery, watcher }) => {
        registerWebSubscription(storage);
        const event = deliveredWrap(1);

        await watcher.handleDelivered(event);

        expect(pushDelivery.webDeliveries).toHaveLength(1);
        expect(pushDelivery.nativeDeliveries).toHaveLength(0);
        expect(hasSeenEvent(storagePath, event.wrap.wrapId)).toBe(true);
      },
    );
  });

  it("does not record backfill before the same wrap arrives live", async () => {
    await withHarness(
      async ({ storage, storagePath, pushDelivery, watcher }) => {
        registerWebSubscription(storage);
        const backfill = deliveredWrap(2, "backfill");

        await watcher.handleDelivered(backfill);

        expect(pushDelivery.webDeliveries).toHaveLength(0);
        expect(hasSeenEvent(storagePath, backfill.wrap.wrapId)).toBe(false);

        await watcher.handleDelivered({ ...backfill, delivery: "live" });

        expect(pushDelivery.webDeliveries).toHaveLength(1);
        expect(hasSeenEvent(storagePath, backfill.wrap.wrapId)).toBe(true);
      },
    );
  });

  it("skips a second live arrival of an already delivered wrap", async () => {
    await withHarness(async ({ storage, pushDelivery, watcher }) => {
      registerWebSubscription(storage);
      const event = deliveredWrap(3);

      await watcher.handleDelivered(event);
      await watcher.handleDelivered(event);

      expect(pushDelivery.webDeliveries).toHaveLength(1);
    });
  });

  it("does not record a wrap without matching subscriptions", async () => {
    await withHarness(async ({ storagePath, pushDelivery, watcher }) => {
      const event = deliveredWrap(4);

      await watcher.handleDelivered(event);

      expect(pushDelivery.webDeliveries).toHaveLength(0);
      expect(pushDelivery.nativeDeliveries).toHaveLength(0);
      expect(hasSeenEvent(storagePath, event.wrap.wrapId)).toBe(false);
    });
  });

  it("allows delivery again after the seen event retention expires", async () => {
    await withHarness(async ({ storage, pushDelivery, watcher }) => {
      registerWebSubscription(storage);
      const event = deliveredWrap(5);
      const firstSeenAt = 1_754_000_000_000;
      setSystemTime(firstSeenAt);

      try {
        await watcher.handleDelivered(event);
        expect(pushDelivery.webDeliveries).toHaveLength(1);

        watcher.pruneSeen(firstSeenAt + retentionMs + 1);
        await watcher.handleDelivered(event);

        expect(pushDelivery.webDeliveries).toHaveLength(2);
      } finally {
        setSystemTime();
      }
    });
  });
});
