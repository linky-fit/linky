import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";

import {
  PushStorage,
  StorageConflictError,
  StorageLimitError,
} from "./storage";
import { createStoragePath, removeStoragePath } from "./testSupport";
import type {
  NativePushSubscriptionData,
  WebPushSubscriptionData,
} from "./types";

const unsafeInteger = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
const pubkeyA = "a".repeat(64);
const pubkeyB = "b".repeat(64);
const nowMs = 1_000_000;

function webSubscription(endpoint: string): WebPushSubscriptionData {
  return {
    endpoint,
    expirationTime: null,
    keys: { p256dh: `p256dh-${endpoint}`, auth: `auth-${endpoint}` },
  };
}

function nativeDevice(token: string): NativePushSubscriptionData {
  return { platform: "android", token };
}

const registerDefaults = {
  cleanupLegacySubscriptions: false,
  installationId: null,
  consumedChallengeNonces: [],
  maxPubkeysPerSubscription: 8,
  maxSubscriptionsPerPubkey: 16,
  nowMs,
};

function withStorage(run: (storage: PushStorage, path: string) => void): void {
  const storagePath = createStoragePath("linky-push-storage-");
  const storage = new PushStorage(storagePath);
  try {
    run(storage, storagePath);
  } finally {
    storage.close();
    removeStoragePath(storagePath);
  }
}

function webEndpointsFor(storage: PushStorage, pubkey: string): string[] {
  return (storage.getSubscriptionsForPubkeys([pubkey]).get(pubkey) ?? []).map(
    (subscription) => subscription.endpoint,
  );
}

function nativeTokensFor(storage: PushStorage, pubkey: string): string[] {
  return (
    storage.getNativeSubscriptionsForPubkeys([pubkey]).get(pubkey) ?? []
  ).map((subscription) => subscription.token);
}

describe("PushStorage web subscriptions", () => {
  it("registers a subscription for each pubkey and replaces its pubkeys on re-register", () => {
    withStorage((storage) => {
      storage.registerSubscription({
        ...registerDefaults,
        subscription: webSubscription("https://push/a"),
        recipientPubkeys: [pubkeyA, pubkeyB],
      });

      const byPubkey = storage.getSubscriptionsForPubkeys([pubkeyA, pubkeyB]);
      expect(byPubkey.get(pubkeyA)?.[0]).toMatchObject({
        endpoint: "https://push/a",
        keys: { p256dh: "p256dh-https://push/a", auth: "auth-https://push/a" },
      });
      expect(byPubkey.get(pubkeyB)?.[0]?.id).toBe(
        byPubkey.get(pubkeyA)?.[0]?.id,
      );

      storage.registerSubscription({
        ...registerDefaults,
        subscription: webSubscription("https://push/a"),
        recipientPubkeys: [pubkeyB],
      });
      expect(webEndpointsFor(storage, pubkeyA)).toEqual([]);
      expect(webEndpointsFor(storage, pubkeyB)).toEqual(["https://push/a"]);
    });
  });

  it("unregisters pubkeys and deletes the subscription with its last pubkey", () => {
    withStorage((storage) => {
      storage.registerSubscription({
        ...registerDefaults,
        subscription: webSubscription("https://push/a"),
        recipientPubkeys: [pubkeyA, pubkeyB],
      });

      expect(
        storage.unregisterSubscriptionPubkeys({
          endpoint: "https://push/a",
          recipientPubkeys: [pubkeyA],
          consumedChallengeNonces: [],
          nowMs,
        }),
      ).toEqual({ removedPubkeys: 1, removedSubscription: false });
      expect(webEndpointsFor(storage, pubkeyA)).toEqual([]);

      expect(
        storage.unregisterSubscriptionPubkeys({
          endpoint: "https://push/a",
          recipientPubkeys: [pubkeyB],
          consumedChallengeNonces: [],
          nowMs,
        }),
      ).toEqual({ removedPubkeys: 1, removedSubscription: true });
      expect(webEndpointsFor(storage, pubkeyB)).toEqual([]);

      expect(
        storage.unregisterSubscriptionPubkeys({
          endpoint: "https://push/unknown",
          recipientPubkeys: [pubkeyB],
          consumedChallengeNonces: [],
          nowMs,
        }),
      ).toEqual({ removedPubkeys: 0, removedSubscription: false });
    });
  });

  it("replaces the endpoint of a subscription with the same installation id", () => {
    withStorage((storage) => {
      storage.registerSubscription({
        ...registerDefaults,
        installationId: "install-1",
        subscription: webSubscription("https://push/old"),
        recipientPubkeys: [pubkeyA],
      });
      const [before] =
        storage.getSubscriptionsForPubkeys([pubkeyA]).get(pubkeyA) ?? [];

      storage.registerSubscription({
        ...registerDefaults,
        installationId: "install-1",
        subscription: webSubscription("https://push/new"),
        recipientPubkeys: [pubkeyA],
      });
      const after =
        storage.getSubscriptionsForPubkeys([pubkeyA]).get(pubkeyA) ?? [];

      expect(after).toHaveLength(1);
      expect(after[0]?.id).toBe(before?.id);
      expect(after[0]?.endpoint).toBe("https://push/new");
    });
  });

  it("removes legacy subscriptions without installation id when asked to", () => {
    withStorage((storage) => {
      storage.registerSubscription({
        ...registerDefaults,
        subscription: webSubscription("https://push/legacy"),
        recipientPubkeys: [pubkeyA, pubkeyB],
      });
      storage.registerSubscription({
        ...registerDefaults,
        installationId: "install-other",
        subscription: webSubscription("https://push/other-device"),
        recipientPubkeys: [pubkeyA],
      });

      storage.registerSubscription({
        ...registerDefaults,
        cleanupLegacySubscriptions: true,
        installationId: "install-1",
        subscription: webSubscription("https://push/current"),
        recipientPubkeys: [pubkeyA],
      });

      expect(webEndpointsFor(storage, pubkeyA).sort()).toEqual([
        "https://push/current",
        "https://push/other-device",
      ]);
      expect(webEndpointsFor(storage, pubkeyB)).toEqual([
        "https://push/legacy",
      ]);
    });
  });

  it("enforces the per-pubkey and per-subscription limits", () => {
    withStorage((storage) => {
      storage.registerSubscription({
        ...registerDefaults,
        maxSubscriptionsPerPubkey: 1,
        subscription: webSubscription("https://push/a"),
        recipientPubkeys: [pubkeyA],
      });

      expect(() =>
        storage.registerSubscription({
          ...registerDefaults,
          maxSubscriptionsPerPubkey: 1,
          subscription: webSubscription("https://push/b"),
          recipientPubkeys: [pubkeyA],
        }),
      ).toThrow(StorageLimitError);
      expect(webEndpointsFor(storage, pubkeyA)).toEqual(["https://push/a"]);

      expect(() =>
        storage.registerSubscription({
          ...registerDefaults,
          maxSubscriptionsPerPubkey: 1,
          subscription: webSubscription("https://push/a"),
          recipientPubkeys: [pubkeyA],
        }),
      ).not.toThrow();

      expect(() =>
        storage.registerSubscription({
          ...registerDefaults,
          maxPubkeysPerSubscription: 1,
          subscription: webSubscription("https://push/c"),
          recipientPubkeys: [pubkeyA, pubkeyB],
        }),
      ).toThrow(StorageLimitError);
    });
  });

  it("removes a subscription by id", () => {
    withStorage((storage) => {
      storage.registerSubscription({
        ...registerDefaults,
        subscription: webSubscription("https://push/a"),
        recipientPubkeys: [pubkeyA],
      });
      const [stored] =
        storage.getSubscriptionsForPubkeys([pubkeyA]).get(pubkeyA) ?? [];
      if (!stored) throw new Error("subscription missing");

      storage.removeSubscriptionById(stored.id);
      expect(webEndpointsFor(storage, pubkeyA)).toEqual([]);
    });
  });
});

describe("PushStorage native subscriptions", () => {
  it("registers and unregisters device tokens", () => {
    withStorage((storage) => {
      storage.registerNativeSubscription({
        ...registerDefaults,
        device: nativeDevice("token-a"),
        recipientPubkeys: [pubkeyA, pubkeyB],
      });
      expect(
        storage.getNativeSubscriptionsForPubkeys([pubkeyA]).get(pubkeyA)?.[0],
      ).toMatchObject({ platform: "android", token: "token-a" });

      expect(
        storage.unregisterNativeSubscriptionPubkeys({
          token: "token-a",
          recipientPubkeys: [pubkeyA, pubkeyB],
          consumedChallengeNonces: [],
          nowMs,
        }),
      ).toEqual({ removedPubkeys: 2, removedSubscription: true });
      expect(nativeTokensFor(storage, pubkeyA)).toEqual([]);
    });
  });

  it("replaces the token of a subscription with the same installation id", () => {
    withStorage((storage) => {
      storage.registerNativeSubscription({
        ...registerDefaults,
        installationId: "install-1",
        device: nativeDevice("token-old"),
        recipientPubkeys: [pubkeyA],
      });
      storage.registerNativeSubscription({
        ...registerDefaults,
        installationId: "install-1",
        device: nativeDevice("token-new"),
        recipientPubkeys: [pubkeyA],
      });

      expect(nativeTokensFor(storage, pubkeyA)).toEqual(["token-new"]);
    });
  });

  it("keeps web and native subscriptions independent", () => {
    withStorage((storage) => {
      storage.registerSubscription({
        ...registerDefaults,
        subscription: webSubscription("https://push/a"),
        recipientPubkeys: [pubkeyA],
      });
      storage.registerNativeSubscription({
        ...registerDefaults,
        device: nativeDevice("token-a"),
        recipientPubkeys: [pubkeyA],
      });

      storage.unregisterNativeSubscriptionPubkeys({
        token: "token-a",
        recipientPubkeys: [pubkeyA],
        consumedChallengeNonces: [],
        nowMs,
      });

      expect(webEndpointsFor(storage, pubkeyA)).toEqual(["https://push/a"]);
      expect(nativeTokensFor(storage, pubkeyA)).toEqual([]);
    });
  });
});

describe("PushStorage challenges", () => {
  it("issues challenges that are consumed exactly once by a registration", () => {
    withStorage((storage) => {
      const nonce = storage.createChallenge(
        pubkeyA,
        "subscribe",
        nowMs + 1000,
        nowMs,
      );
      expect(storage.getChallenge(nonce)).toEqual({
        nonce,
        pubkey: pubkeyA,
        action: "subscribe",
        expiresAt: nowMs + 1000,
        usedAt: null,
      });

      storage.registerSubscription({
        ...registerDefaults,
        consumedChallengeNonces: [nonce],
        subscription: webSubscription("https://push/a"),
        recipientPubkeys: [pubkeyA],
      });
      expect(storage.getChallenge(nonce)?.usedAt).toBe(nowMs);

      expect(() =>
        storage.registerSubscription({
          ...registerDefaults,
          consumedChallengeNonces: [nonce],
          subscription: webSubscription("https://push/b"),
          recipientPubkeys: [pubkeyA],
        }),
      ).toThrow(StorageConflictError);
      expect(webEndpointsFor(storage, pubkeyA)).toEqual(["https://push/a"]);
    });
  });

  it("rejects expired challenges and prunes them", () => {
    withStorage((storage) => {
      const nonce = storage.createChallenge(
        pubkeyA,
        "unsubscribe",
        nowMs + 1000,
        nowMs,
      );

      expect(() =>
        storage.registerSubscription({
          ...registerDefaults,
          nowMs: nowMs + 1000,
          consumedChallengeNonces: [nonce],
          subscription: webSubscription("https://push/a"),
          recipientPubkeys: [pubkeyA],
        }),
      ).toThrow(StorageConflictError);

      storage.pruneChallenges(nowMs + 1000);
      expect(storage.getChallenge(nonce)).toBeNull();
    });
  });
});

describe("PushStorage rowids", () => {
  it("skips subscriptions whose ids exceed Number.MAX_SAFE_INTEGER", () => {
    withStorage((storage, storagePath) => {
      const db = new Database(storagePath);
      db.query(
        `
          INSERT INTO subscriptions (
            id, endpoint, installation_id, p256dh, auth, expiration_time, created_at, updated_at
          ) VALUES (?, ?, NULL, ?, ?, NULL, ?, ?)
        `,
      ).run(
        unsafeInteger,
        "https://example.com/push-unsafe",
        "p256dh",
        "auth",
        1,
        1,
      );
      db.query(
        "INSERT INTO subscription_pubkeys (subscription_id, pubkey, created_at) VALUES (?, ?, ?)",
      ).run(unsafeInteger, "pubkey-1", 1);
      db.close();

      expect(storage.getSubscriptionsForPubkeys(["pubkey-1"]).size).toBe(0);
    });
  });

  it("throws when a new subscription rowid exceeds Number.MAX_SAFE_INTEGER", () => {
    withStorage((storage, storagePath) => {
      const db = new Database(storagePath);
      db.query(
        `
          INSERT INTO subscriptions (
            endpoint, installation_id, p256dh, auth, expiration_time, created_at, updated_at
          ) VALUES (?, NULL, ?, ?, NULL, ?, ?)
        `,
      ).run("https://example.com/bootstrap", "p256dh", "auth", 1, 1);
      db.query("DELETE FROM subscriptions WHERE endpoint = ?").run(
        "https://example.com/bootstrap",
      );
      db.query(
        "UPDATE sqlite_sequence SET seq = ? WHERE name = 'subscriptions'",
      ).run(BigInt(Number.MAX_SAFE_INTEGER));
      db.close();

      expect(() =>
        storage.registerSubscription({
          ...registerDefaults,
          subscription: webSubscription("https://example.com/overflow"),
          recipientPubkeys: [],
        }),
      ).toThrow("Subscription rowid exceeds Number.MAX_SAFE_INTEGER");
    });
  });
});
